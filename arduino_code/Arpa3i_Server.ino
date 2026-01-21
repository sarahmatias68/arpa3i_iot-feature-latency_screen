/**
 * =====================================================================================
 * @file        servidor_arpa3i_v_47_CAM.ino
 * @project     ARPA3I - Sistema de Monitoramento Assistivo para Idosos
 * @device      ESP32-CAM (Servidor Central / Gateway)
 * @version     47.5 (Stable - Clean Architecture)
 * @date        Janeiro / 2026
 * * @description
 * SERVIDOR DE MISSÃO CRÍTICA (24/7): 
 * Este firmware atua como o cérebro do ecossistema ARPA3I. Ele gerencia a conexão 
 * de múltiplos sensores (Wi-Fi/ESP-NOW), processa alertas em tempo real via WebSocket, 
 * persiste o histórico em banco de dados SQLite local (Cartão SD) e notifica o 
 * Aplicativo Mobile e integrações externas (Node-RED).
 * * @architecture
 * - Padrão CQRS / Event Sourcing: Histórico baseado em uma Timeline Imutável.
 * - Clean Code: Sem código morto, rotas obsoletas ou tabelas legadas.
 * - Programação Defensiva: Proteção contra Stack Overflow e travamentos de SQL.
 * * @changelog_v47
 * [✓] FASE 1: Migração do Banco de Dados para arquitetura de log unificado (Tabela: timeline).
 * [✓] FASE 2: Refatoração da API HTTP. Remoção da rota legada '/alerts'. Implementação
 * de auditoria imutável na rota '/acknowledge'.
 * [✓] FASE 3: Implementação do Watchdog de Conectividade (Proteção contra WiFi Freeze).
 * Reinício autônomo após 10 min de falha na rede. Reconexão não-bloqueante.
 * [✓] FIX:    Otimização de memória RAM, remoção de leituras de hardware instáveis (Temp) 
 * e estabilização de variáveis globais (isOtaUpdating).
 * * @warning
 * CÓDIGO DE MISSÃO CRÍTICA: Qualquer alteração nas funções de ISR, WebSocket ou SQLite 
 * deve ser submetida a testes rigorosos de vazamento de memória (Memory Leak) e 
 * concorrência de threads. A falha no processamento de alertas é inaceitável.
 * =====================================================================================
 */

#include <WiFi.h>
#include <WiFiManager.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include "time.h"
#include "SD_MMC.h"
#include "FS.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include <sqlite3.h>
#include "esp_task_wdt.h"
#include <map>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Ticker.h>
#include <ArduinoOTA.h>
#include <Preferences.h>
#include <WiFiMulti.h>
#include <rom/rtc.h>  // [NOVO v44] Para ler motivo do reset
#include "esp_mac.h"

// =================================================================================
// 1. CONFIGURAÇÕES E GLOBAIS
// =================================================================================

// Hardware
const int BUTTON_PIN = 0;
const int LED_PIN = 33;

// Configurações Dinâmicas (Salvas na Flash)
// Valores padrão caso não tenha nada salvo na nova variável 'nodeRedUrl'
String ntpServer = "pool.ntp.org";
int timezone = -3;
int daylightOffset_sec = 0;

// ONDE A MÁGICA ACONTECE: O padrão aponta para o Docker IP novo.
// Se você mudar no portal depois, ele respeita a mudança.
String nodeRedUrl = "http://192.168.2.128:1880/alerta";

String systemHostname = "";

// --- CONFIGURAÇÕES DO SISTEMA ---
int wdtTimeout = 20;                 // Watchdog (s)
String otaPass = "123";              // Senha OTA
int wmTimeout = 180;                 // Timeout WiFi Manager (s)
unsigned long pingInterval = 15000;  // Intervalo Ping (ms)

// Status e Controle
enum DeviceStatus {
  SYS_BOOTING,
  SYS_CONFIG_AP,
  SYS_CONNECTING,
  SYS_ONLINE,
  SYS_ALERT_SENT,
  SYS_ERROR,
  SYS_UPDATING
};
volatile DeviceStatus targetStatus = SYS_BOOTING;
DeviceStatus currentStatus = SYS_UPDATING;

AsyncWebServer server(86);  // Porta 86
AsyncWebSocket ws("/ws");
std::map<uint32_t, String> clientDeviceIds;
std::map<String, String> childGatewayMap;
unsigned long ultimoPing = 0;

// [FASE 3] Watchdog de Conectividade
unsigned long lastConnectionTime = 0;
const unsigned long connectionTimeoutMs = 600000;  // 10 minutos sem Wi-Fi = Reset
Ticker wifiReconnectTimer;

char deviceId[40] = "Servidor_Arpa3i";
WiFiMulti wifiMulti;

Preferences preferences;
bool shouldSaveConfig = false;

bool isCardMounted = false;
bool isOtaUpdating = false;

// Tickers e LEDs
Ticker ledTicker;
Ticker pulseTicker;
const bool LED_ON_STATE = LOW;

// Controle de Alertas e Fila Web
volatile bool logPending = false;
String pendingCategory;
String pendingSeverity;
String pendingMessage;
String pendingSource;

// Fila de Envios (Antigo Vercel -> Agora Node-RED)
volatile bool webSendPending = false;
String webPendingType;
String webPendingLocal;
String webPendingDevice;

// Banco de Dados
sqlite3 *db;
const char *db_path = "/sdcard/arpa3i_data.db";

// Botão
int buttonState = HIGH;
int lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const long debounceDelay = 50;
unsigned long buttonPressStartTime = 0;
bool longPressActionTaken = false;
const long longPressDuration = 5000;

// =================================================================================
// 2. PROTÓTIPOS
// =================================================================================
void loadPreferences();
void forceUpdateConfig();  // Nova função de segurança
void saveConfigCallback();
void wifiManagerCallback(WiFiManager *myWiFiManager);
void setupOTA();
void setupWebSocket();
void WiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info);
void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len);
void enviarStatusServidor();
void initDatabase();
void logSystemCrash(String mensagem);  // [NOVO v44]
void checkConnectionWatchdog();

// Funções renomeadas para refletir a nova realidade (sem Vercel)
void processarFilaAlertas();
void enviarAlertaNodeRED(String tipoAlerta, String local, String dispositivo);

void resetFailedConnectionCounter();
void handleLogin(AsyncWebServerRequest *request);
void handleUsersGet(AsyncWebServerRequest *request);
void handleUserAdd(AsyncWebServerRequest *request);
void handleUserUpdate(AsyncWebServerRequest *request);
void handleUserDelete(AsyncWebServerRequest *request);
void handleUserResetPassword(AsyncWebServerRequest *request);
void handleElderlyGet(AsyncWebServerRequest *request);
void handleElderlyAdd(AsyncWebServerRequest *request);
void handleElderlyUpdate(AsyncWebServerRequest *request);
void handleCaregiversGet(AsyncWebServerRequest *request);
void handleCaregiversAdd(AsyncWebServerRequest *request);
void handleCaregiversUpdate(AsyncWebServerRequest *request);
void handleAlertsGet(AsyncWebServerRequest *request);
void handleTimelineGet(AsyncWebServerRequest *request);
void handleAcknowledgeAlert(AsyncWebServerRequest *request);
void handleDevicesGet(AsyncWebServerRequest *request);
void handleDevicesSet(AsyncWebServerRequest *request);
void handleDevicesDelete(AsyncWebServerRequest *request);
void logEvent(String category, String severity, String source, String description);
void processPendingLogs();
void handleButton();
int db_exec(sqlite3 *db, const char *sql);
String getFormattedTime();
void setSystemStatus(DeviceStatus status);
void processLedStatus();
void _tickToggle();
void _tickHeartbeat();
void broadcastFallAlert(String local, String dispositivo);
void broadcastPanicAlert(String dispositivo);
void broadcastGasAlert(String local, String dispositivo);
void broadcastSmokeAlert(String local, String dispositivo);
void broadcastPossibleFallAlert(String local, String dispositivo);
void broadcastSensorFailureAlert(String local, String dispositivo);
void sendAckToClient(AsyncWebSocketClient *client, const char *alertType);
void saveNetworkToHistory();
void saveConfig();

// =================================================================================
// 3. HTML DO PAINEL DE CONFIGURAÇÃO (ATUALIZADO SEM VERCEL/API KEY)
// =================================================================================

// ================= PÁGINA PÚBLICA (STATUS) =================
const char index_html[] PROGMEM = R"rawliteral(
<!DOCTYPE HTML><html>
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Status Servidor</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background-color: #f0f2f5; color: #333; padding: 20px; text-align: center; margin:0; }
    .container { max-width: 400px; margin: auto; background: #fff; padding: 25px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
    h2 { color: #444; margin-bottom: 5px; margin-top: 0; }
    .status-badge { display: inline-block; padding: 5px 15px; border-radius: 20px; background-color: #d4edda; color: #155724; font-weight: bold; margin-bottom: 20px; }
    .stat-grid { display: grid; grid-template-columns: 1fr; gap: 10px; text-align: left; }
    .stat-item { background: #f8f9fa; padding: 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; }
    .label { font-size: 12px; color: #666; display: block; font-weight: 600; }
    .value { font-size: 15px; font-weight: bold; color: #333; display: block; margin-top: 0; }
    .btn { display: block; width: 100%; padding: 12px; margin-top: 25px; border: none; border-radius: 8px; background-color: #007BFF; color: white; text-decoration: none; font-weight: bold; transition: 0.3s; box-sizing: border-box; }
    .btn:hover { background-color: #0056b3; }
    .footer { font-size: 10px; color: #aaa; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Servidor Arpa3i</h2>
    <div class="status-badge">● ONLINE (LOCAL)</div>

    <div class="stat-grid">
      <div class="stat-item">
        <span class="label">Dispositivo</span>
        <span class="value" id="devId">Carregando...</span>
      </div>
      <div class="stat-item">
        <span class="label">Tempo Online</span>
        <span class="value" id="uptime">--:--:--</span>
      </div>
      <div class="stat-item">
        <span class="label">Sinal Wi-Fi</span>
        <span class="value" id="rssi">-- dBm</span>
      </div>
      <div class="stat-item">
        <span class="label">Memória Livre</span>
        <span class="value" id="heap">-- KB</span>
      </div>
    </div>

    <a href="/config" class="btn">⚙️ ACESSAR CONFIGURAÇÕES</a>
    <div class="footer">Sistema de Monitoramento v48</div>
  </div>

<script>
  function fmt(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m) + ":" + (sec < 10 ? "0" + sec : sec);
  }

  function up() {
    fetch('/api/public-status').then(r => r.json()).then(d => {
      document.getElementById('devId').innerText = d.deviceId;
      document.getElementById('uptime').innerText = fmt(d.uptime);
      document.getElementById('rssi').innerText = d.rssi + " dBm (" + d.signal + "%)";
      document.getElementById('heap').innerText = (d.heap / 1024).toFixed(1) + " KB";
    });
  }
  setInterval(up, 2000); 
  up(); 
</script>
</body>
</html>
)rawliteral";

const char config_html[] PROGMEM = R"rawliteral(
<!DOCTYPE HTML><html>
<head>
  <meta charset="UTF-8">
  <title>Admin Servidor Arpa3i</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: 'Segoe UI', Arial; background-color: #f4f4f9; color: #333; padding: 20px; text-align: center; }
    .container { max-width: 500px; margin: auto; background: #fff; padding: 25px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
    h2 { color: #007BFF; }
    label { font-weight: bold; display: block; margin-top: 15px; text-align: left; }
    input { width: 100%; padding: 10px; margin-top: 5px; border: 1px solid #ccc; border-radius: 5px; box-sizing: border-box; }
    .btn { padding: 12px; margin-top: 20px; width: 100%; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; font-weight: bold; color: white; transition: 0.3s; }
    .btn-save { background-color: #28a745; } .btn-save:hover { background-color: #218838; }
    .btn-restart { background-color: #dc3545; margin-top: 10px; } .btn-restart:hover { background-color: #c82333; }
    .info { font-size: 12px; color: #666; margin-top: 5px; text-align: left; }
    hr { margin-top: 20px; border: 0; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Configuração Servidor</h2>
    <a href="/wifi-manager" class="btn" style="background-color:#17a2b8; margin-bottom:20px; display:block; text-decoration:none;">📡 GERENCIAR REDES WI-FI</a>
    
    <form action="/save-config" method="POST">
      <label>ID do Servidor (Nome na Rede)</label>
      <input type="text" name="deviceId" id="deviceId">

      <label>URL Node-RED Webhook</label>
      <input type="text" name="nodeRedUrl" id="nodeRedUrl">
      
      <label>Fuso Horário (Ex: -3)</label>
      <input type="number" name="timezone" id="timezone">
      
      <hr>
      
      <label>Senha OTA (Atualização)</label>
      <input type="text" name="otaPass" id="otaPass">

      <label>Watchdog Timeout (Segundos)</label>
      <input type="number" name="wdtTimeout" id="wdtTimeout">
      
      <label>Timeout WiFi Manager (Segundos)</label>
      <input type="number" name="wmTimeout" id="wmTimeout">

      <label>Intervalo Ping/Heartbeat (ms)</label>
      <input type="number" name="pingInterval" id="pingInterval">

      <button type="submit" class="btn btn-save">SALVAR CONFIGURAÇÕES</button>
    </form>
    <button onclick="restartESP()" class="btn btn-restart">REINICIAR SERVIDOR</button>
  </div>
<script>
  fetch('/api/config-values')
    .then(response => response.json())
    .then(data => {
      // Carrega o valor da nova variavel
      document.getElementById('deviceId').value = data.deviceId; // <--- NOVA LINHA
      document.getElementById('nodeRedUrl').value = data.nodeRedUrl;
      document.getElementById('timezone').value = data.timezone;
      
      document.getElementById('otaPass').value = data.otaPass;
      document.getElementById('wdtTimeout').value = data.wdtTimeout;
      document.getElementById('wmTimeout').value = data.wmTimeout;
      document.getElementById('pingInterval').value = data.pingInterval;
    });
  function restartESP() {
    if(confirm("Deseja realmente reiniciar o servidor?")) {
      fetch('/restart', { method: 'POST' });
      alert("Reiniciando... Aguarde 10s e recarregue.");
    }
  }
</script>
</body>
</html>
)rawliteral";

// ================= PÁGINA DE GERENCIAMENTO WI-FI (MANTIDA) =================
const char wifi_html[] PROGMEM = R"rawliteral(
<!DOCTYPE HTML><html>
<head>
  <meta charset="UTF-8">
  <title>Gerenciar Redes Wi-Fi</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: 'Segoe UI', Arial; background-color: #f4f4f9; color: #333; padding: 20px; text-align: center; }
    .container { max-width: 500px; margin: auto; background: #fff; padding: 25px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
    h2 { color: #007BFF; margin-bottom: 20px; }
    .slot-card { background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px; text-align: left; border-left: 5px solid #ccc; }
    .slot-card.active { border-left-color: #28a745; }
    label { font-size: 12px; font-weight: bold; color: #666; display: block; margin-top: 5px; }
    input { width: 100%; padding: 8px; margin-top: 2px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
    .btn-row { display: flex; justify-content: space-between; margin-top: 10px; }
    button { padding: 8px 15px; border: none; border-radius: 4px; cursor: pointer; color: white; font-weight: bold; font-size: 12px; }
    .btn-save { background-color: #007BFF; }
    .btn-clear { background-color: #dc3545; }
    .btn-back { background-color: #6c757d; width: 100%; padding: 12px; margin-top: 20px; display: block; text-decoration: none; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Gerenciar Redes Salvas</h2>
    <p style="font-size:12px; color:#666;">O sistema tentará conectar nestas redes na ordem abaixo (Slot 0 -> 1 -> 2).</p>

    <div class="slot-card" id="card0">
      <strong>Rede Principal (Slot 0)</strong>
      <label>SSID (Nome da Rede)</label>
      <input type="text" id="s0">
      <label>Senha</label>
      <input type="password" id="p0">
      <div class="btn-row">
        <button class="btn-save" onclick="saveSlot(0)">SALVAR</button>
        <button class="btn-clear" onclick="clearSlot(0)">APAGAR</button>
      </div>
    </div>

    <div class="slot-card" id="card1">
      <strong>Rede Secundária (Slot 1)</strong>
      <label>SSID (Nome da Rede)</label>
      <input type="text" id="s1">
      <label>Senha</label>
      <input type="password" id="p1">
      <div class="btn-row">
        <button class="btn-save" onclick="saveSlot(1)">SALVAR</button>
        <button class="btn-clear" onclick="clearSlot(1)">APAGAR</button>
      </div>
    </div>

    <div class="slot-card" id="card2">
      <strong>Rede Terciária (Slot 2)</strong>
      <label>SSID (Nome da Rede)</label>
      <input type="text" id="s2">
      <label>Senha</label>
      <input type="password" id="p2">
      <div class="btn-row">
        <button class="btn-save" onclick="saveSlot(2)">SALVAR</button>
        <button class="btn-clear" onclick="clearSlot(2)">APAGAR</button>
      </div>
    </div>

    <a href="/config" class="btn-back">VOLTAR PARA CONFIGURAÇÕES</a>
  </div>

<script>
  // Carrega as redes salvas
  fetch('/api/wifi-list')
    .then(response => response.json())
    .then(data => {
      for(let i=0; i<3; i++) {
        document.getElementById('s'+i).value = data['s'+i];
        document.getElementById('p'+i).value = data['p'+i];
        if(data['s'+i] !== "") document.getElementById('card'+i).className += " active";
      }
    });

  function saveSlot(id) {
    const ssid = document.getElementById('s'+id).value;
    const pass = document.getElementById('p'+id).value;
    if(!ssid) return alert("Digite o nome da rede!");
    
    const formData = new FormData();
    formData.append("slot", id);
    formData.append("ssid", ssid);
    formData.append("pass", pass);
    
    fetch('/api/wifi-save', { method: 'POST', body: formData })
      .then(r => r.text())
      .then(msg => { alert("Salvo!"); location.reload(); });
  }

  function clearSlot(id) {
    if(!confirm("Deseja apagar esta rede da memória?")) return;
    const formData = new FormData();
    formData.append("slot", id);
    formData.append("clear", "true");
    
    fetch('/api/wifi-save', { method: 'POST', body: formData })
      .then(r => r.text())
      .then(msg => { alert("Apagado!"); location.reload(); });
  }
</script>
</body>
</html>
)rawliteral";

// =================================================================================
// 4. SETUP
// =================================================================================

void setup() {
  Serial.begin(115200);
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);  // Desabilita detector de Brownout
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  setSystemStatus(SYS_BOOTING);
  processLedStatus();

  loadPreferences();
  forceUpdateConfig();  // <<< O SEGREDO: Garante o IP novo do Docker

  // MAC Correction
  WiFi.mode(WIFI_STA);
  delay(100);
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char macSuffix[7];
  sprintf(macSuffix, "%02X%02X%02X", mac[3], mac[4], mac[5]);
  if (strcmp(deviceId, "Servidor_Arpa3i") == 0) {
    systemHostname = "Servidor_Arpa3i_" + String(macSuffix);
    strcpy(deviceId, systemHostname.c_str());
    saveConfig();
  } else systemHostname = String(deviceId);

  // Inicia o SD_MMC no modo 1-bit
  if (!SD_MMC.begin("/sdcard", true)) {
    Serial.println("Falha SD Card Montagem");
  } else {
    // --- A CORREÇÃO MÁGICA ---
    Serial.println("SD Card OK (Modo SD_MMC).");
    isCardMounted = true;  // <--- ADICIONE ESTA LINHA OBRIGATORIAMENTE
    // -------------------------
  }

  // Registra o motivo do reinício para auditoria
  logSystemCrash("=== SERVIDOR INICIADO (BOOT v48) ===");
  String resetReason = "Reset CPU 0: " + String(rtc_get_reset_reason(0));
  logSystemCrash(resetReason);

  if (isCardMounted) {
    initDatabase();
  } else {
    Serial.println("ALERTA: Rodando sem Banco de Dados (Modo Emergencia)");
  }

  WiFi.onEvent(WiFiEvent);

  // --- TENTATIVA MULTI-WIFI (REDES CONHECIDAS) ---
  preferences.begin("wifi-history", true);
  String s0 = preferences.getString("s0", "");
  String p0 = preferences.getString("p0", "");
  String s1 = preferences.getString("s1", "");
  String p1 = preferences.getString("p1", "");
  String s2 = preferences.getString("s2", "");
  String p2 = preferences.getString("p2", "");
  preferences.end();

  if (s0 != "") wifiMulti.addAP(s0.c_str(), p0.c_str());
  if (s1 != "") wifiMulti.addAP(s1.c_str(), p1.c_str());
  if (s2 != "") wifiMulti.addAP(s2.c_str(), p2.c_str());

  Serial.println("Tentando conectar em redes conhecidas (Multi-WiFi)...");
  bool connected = false;
  if (s0 != "" || s1 != "" || s2 != "") {
    unsigned long startAttempt = millis();
    while (millis() - startAttempt < 10000) {
      if (wifiMulti.run() == WL_CONNECTED) {
        connected = true;
        break;
      }
      delay(500);
      Serial.print(".");
    }
  }

  // --- WIFIMANAGER (CASO NÃO CONECTE) ---
  WiFiManager wm;
  wm.setAPCallback(wifiManagerCallback);
  wm.setSaveConfigCallback(saveConfigCallback);
  wm.setConfigPortalTimeout(wmTimeout);

  WiFiManagerParameter custom_server_id("serverid", "ID do Servidor", deviceId, 40);
  wm.addParameter(&custom_server_id);

  String apName = "Servidor_Arpa3i_" + String(macSuffix);

  if (connected) {
    Serial.println("\nConectado via Multi-WiFi!");
  } else {
    Serial.println("\nNenhuma rede conhecida. Abrindo Portal AP: " + apName);
    if (!wm.autoConnect(apName.c_str())) {
      Serial.println("Falha ao conectar. Reiniciando...");
      setSystemStatus(SYS_ERROR);
      processLedStatus();
      delay(3000);
      ESP.restart();
    } else {
      saveNetworkToHistory();
    }
  }

  if (shouldSaveConfig) {
    strcpy(deviceId, custom_server_id.getValue());
    Serial.println("Salvando novo ID na memoria: " + String(deviceId));
    preferences.begin("server-config", false);
    preferences.putString("deviceId", deviceId);
    preferences.end();
  }

  setSystemStatus(SYS_ONLINE);
  processLedStatus();
  Serial.println("\nConectado! IP: " + WiFi.localIP().toString());

  configTime(timezone * 3600, daylightOffset_sec, ntpServer.c_str());
  delay(1000);
  setupWebSocket();
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");

  // --- ROTAS DO SERVIDOR WEB ---
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send_P(200, "text/html", index_html);
  });

  // API de Status Público
  server.on("/api/public-status", HTTP_GET, [](AsyncWebServerRequest *request) {
    StaticJsonDocument<200> doc;
    doc["deviceId"] = deviceId;
    doc["uptime"] = millis() / 1000;
    doc["heap"] = ESP.getFreeHeap();
    int rssi = WiFi.RSSI();
    doc["rssi"] = rssi;
    int quality = 2 * (rssi + 100);
    if (quality > 100) quality = 100;
    else if (quality < 0) quality = 0;
    doc["signal"] = quality;
    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
  });

  // Configuração (Protegida)
  server.on("/config", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (!request->authenticate("admin", otaPass.c_str())) {
      return request->requestAuthentication();
    }
    request->send_P(200, "text/html", config_html);
  });

  // API Valores Config (Atualizada para nova variável)
  server.on("/api/config-values", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (!request->authenticate("admin", otaPass.c_str())) {
      return request->requestAuthentication();
    }
    String json = "{";
    // Envia o ID atual para o HTML
    json += "\"deviceId\":\"" + String(deviceId) + "\",";  // <--- NOVA LINHA
    // Retorna a URL do Node-RED ao invés do Vercel
    json += "\"nodeRedUrl\":\"" + nodeRedUrl + "\",";
    json += "\"timezone\":" + String(timezone) + ",";
    json += "\"otaPass\":\"" + otaPass + "\",";
    json += "\"wdtTimeout\":" + String(wdtTimeout) + ",";
    json += "\"wmTimeout\":" + String(wmTimeout) + ",";
    json += "\"pingInterval\":" + String(pingInterval);
    json += "}";
    request->send(200, "application/json", json);
  });

  // Salvar Configurações (Centralizado na função saveConfig)
  server.on("/save-config", HTTP_POST, [](AsyncWebServerRequest *request) {
    // 1. Autenticação
    if (!request->authenticate("admin", otaPass.c_str())) {
      return request->requestAuthentication();
    }

    // 2. Verificação Mínima e Atualização das Variáveis GLOBAIS
    // Nota: Alteramos a verificação mínima para aceitar se tiver deviceId OU nodeRedUrl
    if (request->hasParam("nodeRedUrl", true) || request->hasParam("deviceId", true)) {

      // Atualiza ID do Servidor (se enviado)
      if (request->hasParam("deviceId", true)) {
        String newId = request->getParam("deviceId", true)->value();
        // Proteção para não estourar o buffer de 40 caracteres
        if (newId.length() < 40) {
          strcpy(deviceId, newId.c_str());
          systemHostname = newId;  // Mantém sincronizado
        }
      }

      // Atualiza NodeRed URL
      if (request->hasParam("nodeRedUrl", true))
        nodeRedUrl = request->getParam("nodeRedUrl", true)->value();

      // Atualiza Timezone (se enviado)
      if (request->hasParam("timezone", true))
        timezone = request->getParam("timezone", true)->value().toInt();

      // Atualiza Senha OTA
      if (request->hasParam("otaPass", true))
        otaPass = request->getParam("otaPass", true)->value();

      // Atualiza WDT
      if (request->hasParam("wdtTimeout", true))
        wdtTimeout = request->getParam("wdtTimeout", true)->value().toInt();

      // Atualiza WiFi Manager Timeout
      if (request->hasParam("wmTimeout", true))
        wmTimeout = request->getParam("wmTimeout", true)->value().toInt();

      // Atualiza Ping Interval
      if (request->hasParam("pingInterval", true))
        pingInterval = request->getParam("pingInterval", true)->value().toInt();

      // 3. CHAMA A FUNÇÃO CENTRALIZADA PARA SALVAR TUDO
      saveConfig();

      request->send(200, "text/html", "<h1>Salvo! Reinicie para aplicar. <a href='/'>Voltar</a></h1>");
    } else {
      request->send(400, "text/plain", "Erro params");
    }
  });

  server.on("/restart", HTTP_POST, [](AsyncWebServerRequest *request) {
    if (!request->authenticate("admin", otaPass.c_str())) {
      return request->requestAuthentication();
    }
    request->send(200, "text/plain", "Reiniciando...");
    delay(1000);
    ESP.restart();
  });

  // --- ROTAS DE GERENCIAMENTO WI-FI (MANTIDAS) ---
  server.on("/wifi-manager", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (!request->authenticate("admin", otaPass.c_str())) return request->requestAuthentication();
    request->send_P(200, "text/html", wifi_html);
  });
  server.on("/api/wifi-list", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (!request->authenticate("admin", otaPass.c_str())) return request->requestAuthentication();
    preferences.begin("wifi-history", true);
    String json = "{";
    for (int i = 0; i < 3; i++) {
      String s = preferences.getString(("s" + String(i)).c_str(), "");
      String p = preferences.getString(("p" + String(i)).c_str(), "");
      json += "\"s" + String(i) + "\":\"" + s + "\",";
      json += "\"p" + String(i) + "\":\"" + p + "\"";
      if (i < 2) json += ",";
    }
    json += "}";
    preferences.end();
    request->send(200, "application/json", json);
  });
  server.on("/api/wifi-save", HTTP_POST, [](AsyncWebServerRequest *request) {
    if (!request->authenticate("admin", otaPass.c_str())) return request->requestAuthentication();
    if (request->hasParam("slot", true)) {
      String slotStr = request->getParam("slot", true)->value();
      int slot = slotStr.toInt();
      if (slot >= 0 && slot <= 2) {
        preferences.begin("wifi-history", false);
        if (request->hasParam("clear", true)) {
          preferences.remove(("s" + String(slot)).c_str());
          preferences.remove(("p" + String(slot)).c_str());
        } else {
          if (request->hasParam("ssid", true) && request->hasParam("pass", true)) {
            preferences.putString(("s" + String(slot)).c_str(), request->getParam("ssid", true)->value());
            preferences.putString(("p" + String(slot)).c_str(), request->getParam("pass", true)->value());
          }
        }
        preferences.end();
        request->send(200, "text/plain", "OK");
      }
    }
    request->send(400, "text/plain", "Erro");
  });

  // --- ROTAS API ORIGINAIS ---
  // --- ROTAS API (ATUALIZADO FASE 2: CLEAN ARCHITECTURE) ---
  server.on("/login", HTTP_POST, handleLogin);
  server.on("/users", HTTP_GET, handleUsersGet);
  server.on("/users/add", HTTP_POST, handleUserAdd);
  server.on("/users/update", HTTP_POST, handleUserUpdate);
  server.on("/users/delete", HTTP_POST, handleUserDelete);
  server.on("/users/reset-password", HTTP_POST, handleUserResetPassword);

  server.on("/elderly", HTTP_GET, handleElderlyGet);
  server.on("/elderly/add", HTTP_POST, handleElderlyAdd);
  server.on("/elderly/update", HTTP_POST, handleElderlyUpdate);

  server.on("/caregivers", HTTP_GET, handleCaregiversGet);
  server.on("/caregivers/add", HTTP_POST, handleCaregiversAdd);
  server.on("/caregivers/update", HTTP_POST, handleCaregiversUpdate);

  // Rota legada '/alerts' mantida como view sobre 'timeline' para compatibilidade com o app
  server.on("/alerts", HTTP_GET, handleAlertsGet);

  // Nova rota '/timeline' (fonte única de verdade para eventos)
  server.on("/timeline", HTTP_GET, handleTimelineGet);
  server.on("/acknowledge", HTTP_POST, handleAcknowledgeAlert);

  server.on("/devices", HTTP_GET, handleDevicesGet);
  server.on("/devices/set", HTTP_POST, handleDevicesSet);
  server.on("/devices/delete", HTTP_POST, handleDevicesDelete);

  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");

  server.begin();
  setupOTA();

  Serial.println("--- Servidor Iniciado v48 ---");
  Serial.println("Dashboard: http://" + WiFi.localIP().toString() + ":86");

  esp_task_wdt_config_t wdt_config = { .timeout_ms = (uint32_t)(wdtTimeout * 1000), .trigger_panic = true };
  esp_task_wdt_init(&wdt_config);
  esp_task_wdt_add(NULL);
  lastConnectionTime = millis();
}

// =================================================================================
// 5. LOOP
// =================================================================================

void loop() {
  ArduinoOTA.handle();
  if (isOtaUpdating) {
    esp_task_wdt_reset();
    return;
  }
  esp_task_wdt_reset();
  checkConnectionWatchdog();
  processLedStatus();
  enviarStatusServidor();
  processPendingLogs();

  // Função renomeada (antiga handleVercelQueue)
  processarFilaAlertas();

  handleButton();
  ws.cleanupClients();
}

// =================================================================================
// 6. IMPLEMENTAÇÃO DAS FUNÇÕES
// =================================================================================

void loadPreferences() {
  preferences.begin("server-config", true);
  String savedId = preferences.getString("deviceId", "");
  if (savedId != "") strlcpy(deviceId, savedId.c_str(), sizeof(deviceId));

  // MUDANÇA: Agora busca 'nodeRedUrl'. Se não existir, retorna a URL padrão do código.
  // Isso resolve o problema de ignorar o Vercel antigo.
  nodeRedUrl = preferences.getString("nodeRedUrl", nodeRedUrl);

  timezone = preferences.getInt("timezone", -3);

  otaPass = preferences.getString("otaPass", otaPass);
  wdtTimeout = preferences.getInt("wdtTimeout", wdtTimeout);
  wmTimeout = preferences.getInt("wmTimeout", wmTimeout);
  pingInterval = preferences.getULong("pingInterval", pingInterval);

  preferences.end();

  Serial.println("--- Configurações Carregadas ---");
  Serial.println("ID: " + String(deviceId));
  Serial.println("Webhook: " + nodeRedUrl);
}

// Essa função garante que se o IP do código mudou (novo docker), ele atualiza a memória
void forceUpdateConfig() {
  // Se a URL na memória for diferente do DEFAULT (e parece ser uma URL velha do vercel ou IP antigo)
  // Forçamos o padrão.
  // Truque: Verifica se contém o IP novo. Se não tiver, sobrescreve.
  if (nodeRedUrl.indexOf("192.168.2.128") == -1) {
    Serial.println("Detectada config antiga! Forcando update para Docker IP...");
    nodeRedUrl = "http://192.168.2.128:1880/alerta";  // Força o padrão
    preferences.begin("server-config", false);
    preferences.putString("nodeRedUrl", nodeRedUrl);
    preferences.end();
  }
}

void saveConfigCallback() {
  Serial.println("Deve salvar as configuracoes...");
  shouldSaveConfig = true;
}

void _tickToggle() {
  digitalWrite(LED_PIN, !digitalRead(LED_PIN));
}

void _tickHeartbeat() {
  digitalWrite(LED_PIN, LED_ON_STATE);
  pulseTicker.once_ms(
    50, +[]() {
      digitalWrite(LED_PIN, !LED_ON_STATE);
    });
}

void setSystemStatus(DeviceStatus status) {
  targetStatus = status;
}

void processLedStatus() {
  if (currentStatus == targetStatus) return;
  currentStatus = targetStatus;
  ledTicker.detach();
  pulseTicker.detach();

  if (currentStatus != SYS_UPDATING) {
    digitalWrite(LED_PIN, !LED_ON_STATE);
  }

  switch (currentStatus) {
    case SYS_BOOTING: ledTicker.attach(0.25, _tickToggle); break;
    case SYS_CONFIG_AP: ledTicker.attach(1.0, _tickToggle); break;
    case SYS_CONNECTING: ledTicker.attach(0.25, _tickToggle); break;
    case SYS_ALERT_SENT: ledTicker.attach(0.5, _tickToggle); break;
    case SYS_ERROR: ledTicker.attach(0.1, _tickToggle); break;
    case SYS_ONLINE: ledTicker.attach(5.0, _tickHeartbeat); break;
    case SYS_UPDATING: digitalWrite(LED_PIN, LED_ON_STATE); break;
  }
}

void wifiManagerCallback(WiFiManager *myWiFiManager) {
  Serial.println("Entrou no modo de configuracao do AP...");
  setSystemStatus(SYS_CONFIG_AP);
  processLedStatus();
}

void setupOTA() {
  ArduinoOTA.setPort(3232);
  ArduinoOTA.setHostname(deviceId);
  ArduinoOTA.setPassword(otaPass.c_str());

  ArduinoOTA.onStart([]() {
    String type = (ArduinoOTA.getCommand() == U_FLASH) ? "sketch" : "filesystem";
    Serial.println("Iniciando OTA (" + type + ")...");
    isOtaUpdating = true;
    setSystemStatus(SYS_UPDATING);
    processLedStatus();
    ws.enable(false);
  });
  ArduinoOTA.onEnd([]() {
    Serial.println("\nFim do OTA.");
    isOtaUpdating = false;
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    esp_task_wdt_reset();
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("Erro OTA[%u]: ", error);
    isOtaUpdating = false;
    setSystemStatus(SYS_ONLINE);
    ESP.restart();
  });
  ArduinoOTA.begin();
  Serial.println("OTA Ativo (Porta 3232).");
}

void sendAckToClient(AsyncWebSocketClient *client, const char *alertType) {
  if (!client || !client->canSend()) return;
  StaticJsonDocument<100> doc;
  doc["type"] = "ACK";
  doc["acked_alert"] = alertType;
  String json;
  serializeJson(doc, json);
  client->text(json);
  Serial.printf("ACK para alerta '%s' enviado ao cliente #%u\n", alertType, client->id());
}

void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    String genericId = "Cliente #" + String(client->id());
    clientDeviceIds[client->id()] = genericId;
    Serial.printf("[WS] %s conectado (IP: %s)\n", genericId.c_str(), client->remoteIP().toString().c_str());
  } else if (type == WS_EVT_DISCONNECT) {
    String devId = clientDeviceIds[client->id()];
    Serial.printf("[WS] Dispositivo '%s' desconectado.\n", devId.c_str());
    String json = "{\"type\":\"DEVICE_STATUS\",\"deviceId\":\"" + devId + "\",\"status\":\"offline\"}";
    ws.textAll(json);

    if (!devId.startsWith("Cliente #") && !devId.startsWith("App_")) {
      logEvent("SYSTEM", "WARNING", devId, "Dispositivo desconectado (Connection Lost)");
      broadcastSensorFailureAlert("Conexao WebSocket perdida", devId);

      for (auto const &[child, parent] : childGatewayMap) {
        if (parent == devId) {
          StaticJsonDocument<128> docOff;
          docOff["type"] = "DEVICE_STATUS";
          docOff["deviceId"] = child;
          docOff["status"] = "offline";
          String jsonOff;
          serializeJson(docOff, jsonOff);
          ws.textAll(jsonOff);
        }
      }
    }
    clientDeviceIds.erase(client->id());
  } else if (type == WS_EVT_DATA) {
    AwsFrameInfo *info = (AwsFrameInfo *)arg;
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
      if (len > 1024) return;
      data[len] = 0;
      DynamicJsonDocument doc(1024);
      if (deserializeJson(doc, (char *)data)) return;

      const char *msgType = doc["type"] | "";
      String devId = "";
      if (doc.containsKey("deviceId")) devId = doc["deviceId"].as<String>();

      if (devId != "" && strcmp(msgType, "DEVICE_STATUS") == 0) {
        if (clientDeviceIds[client->id()] != devId) {
          clientDeviceIds[client->id()] = devId;
          ws.textAll("{\"type\":\"DEVICE_STATUS\",\"deviceId\":\"" + devId + "\",\"status\":\"online\"}");
        }
      }
      if (devId == "") devId = clientDeviceIds[client->id()];

      // --- TRATAMENTO PADRONIZADO E ESTRITO (V48 - FLAT JSON) ---
      if (strcmp(msgType, "HEARTBEAT") == 0 || strcmp(msgType, "DEVICE_STATUS") == 0) {
        DynamicJsonDocument out(512);
        out["type"] = "DEVICE_STATUS";
        out["deviceId"] = devId;
        out["status"] = "online";
        
        // Mapeamento Estrito (Lista Branca)
        if (doc.containsKey("uptimeSec")) out["uptimeSec"] = doc["uptimeSec"];
        if (doc.containsKey("rssiDbm")) out["rssiDbm"] = doc["rssiDbm"];
        if (doc.containsKey("batteryMv")) out["batteryMv"] = doc["batteryMv"];
        if (doc.containsKey("reconnects")) out["reconnects"] = doc["reconnects"];
        if (doc.containsKey("ip")) out["ip"] = doc["ip"];
        if (doc.containsKey("heapB")) out["heapB"] = doc["heapB"];

        if (doc.containsKey("tempCpu")) {
          out["tempCpuC"] = doc["tempCpu"];
          out["tempInternal"] = doc["tempCpu"];
        }
        
        if (doc.containsKey("signal")) out["signal"] = doc["signal"]; 

        String jsonOut;
        serializeJson(out, jsonOut);
        ws.textAll(jsonOut);

      } else if (strcmp(msgType, "ALERTA") == 0) {
        const char *subType = doc["sub_type"] | "GERAL";
        String local = doc["detalhes"]["local"] | "Local Desc.";

        String sev = "CRITICAL";
        String cat = "ALERT";
        if (String(subType) == "POSSIVEL_QUEDA") sev = "WARNING";
        if (String(subType) == "FALHA_SENSOR") {
          sev = "WARNING";
          cat = "SYSTEM";
        }

        logEvent(cat, sev, devId, String(subType) + " em " + local);

        if (strcmp(subType, "PANICO") == 0) broadcastPanicAlert(devId);
        else if (strcmp(subType, "QUEDA") == 0) broadcastFallAlert(local, devId);
        else if (strcmp(subType, "GAS") == 0) broadcastGasAlert(local, devId);
        else if (strcmp(subType, "FUMACA") == 0) broadcastSmokeAlert(local, devId);
        else if (strcmp(subType, "POSSIVEL_QUEDA") == 0) broadcastPossibleFallAlert(local, devId);
        else if (strcmp(subType, "FALHA_SENSOR") == 0) broadcastSensorFailureAlert(local, devId);
        else if (strcmp(subType, "PORTAO_ACIONADO") == 0) {
          String msg = doc["message"] | "Acionamento remoto";
          logEvent("ACCESS", "INFO", devId, msg.c_str());
          String json;
          serializeJson(doc, json);
          ws.textAll(json);
        } else if (strcmp(subType, "PORTAO_STATUS") == 0) { // [NOVO v48] Suporte ao Status
           String msg = doc["detalhes"]["estado"] | "Estado Desc.";
           // Opcional: Logar mudança de estado se desejar auditoria fina
           // logEvent("ACCESS", "INFO", devId, ("Status: " + msg).c_str()); 
           String json; serializeJson(doc, json); ws.textAll(json);
        }

        sendAckToClient(client, subType);

      } else if (strcmp(msgType, "ACK_ALERTA") == 0) {
        logEvent("SYSTEM", "INFO", devId, "Usuario confirmou alerta");

      } else if (strcmp(msgType, "COMANDO") == 0) {
        String target = doc["target"] | "";
        String payloadStr;
        serializeJson(doc["payload"], payloadStr);
        for (auto const &[cId, cName] : clientDeviceIds) {
          if (target == cName || target == "BROADCAST_ALL") ws.text(cId, payloadStr);
        }
      } else {
        String out;
        serializeJson(doc, out);
        ws.textAll(out);
      }
    }
  }
}

void broadcastFallAlert(String local, String dispositivo) {
  StaticJsonDocument<200> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = "QUEDA";
  doc["dispositivo"] = dispositivo;
  JsonObject detalhes = doc.createNestedObject("detalhes");
  detalhes["local"] = local;
  doc["timestamp"] = getFormattedTime();
  doc["epoch_ms"] = (uint32_t)millis();
  String json;
  serializeJson(doc, json);
  ws.textAll(json);

  Serial.println(">>> Agendando envio WEB (Node-RED): QUEDA");
  webPendingType = "QUEDA";
  webPendingLocal = local;
  webPendingDevice = dispositivo;
  webSendPending = true;
  setSystemStatus(SYS_ALERT_SENT);
}

void broadcastPanicAlert(String dispositivo) {
  StaticJsonDocument<200> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = "PANICO";
  doc["dispositivo"] = dispositivo;
  doc["timestamp"] = getFormattedTime();
  doc["epoch_ms"] = (uint32_t)millis();
  String json;
  serializeJson(doc, json);
  ws.textAll(json);

  Serial.println(">>> Agendando envio WEB (Node-RED): PANICO");
  webPendingType = "PANICO";
  webPendingLocal = "";
  webPendingDevice = dispositivo;
  webSendPending = true;
  setSystemStatus(SYS_ALERT_SENT);
}

void broadcastGasAlert(String local, String dispositivo) {
  StaticJsonDocument<200> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = "GAS";
  doc["dispositivo"] = dispositivo;
  JsonObject detalhes = doc.createNestedObject("detalhes");
  detalhes["local"] = local;
  doc["timestamp"] = getFormattedTime();
  doc["epoch_ms"] = (uint32_t)millis();
  String json;
  serializeJson(doc, json);
  ws.textAll(json);

  Serial.println(">>> Agendando envio WEB (Node-RED): GAS");
  webPendingType = "GAS";
  webPendingLocal = local;
  webPendingDevice = dispositivo;
  webSendPending = true;
  setSystemStatus(SYS_ALERT_SENT);
}

void broadcastSmokeAlert(String local, String dispositivo) {
  StaticJsonDocument<200> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = "FUMACA";
  doc["dispositivo"] = dispositivo;
  JsonObject detalhes = doc.createNestedObject("detalhes");
  detalhes["local"] = local;
  doc["timestamp"] = getFormattedTime();
  doc["epoch_ms"] = (uint32_t)millis();
  String json;
  serializeJson(doc, json);
  ws.textAll(json);

  Serial.println(">>> Agendando envio WEB (Node-RED): FUMACA");
  webPendingType = "FUMACA";
  webPendingLocal = local;
  webPendingDevice = dispositivo;
  webSendPending = true;
  setSystemStatus(SYS_ALERT_SENT);
}

void broadcastPossibleFallAlert(String local, String dispositivo) {
  StaticJsonDocument<256> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = "POSSIVEL_QUEDA";
  doc["dispositivo"] = dispositivo;
  JsonObject detalhes = doc.createNestedObject("detalhes");
  detalhes["local"] = local;
  doc["timestamp"] = getFormattedTime();
  doc["epoch_ms"] = (uint32_t)millis();
  String json;
  serializeJson(doc, json);
  ws.textAll(json);

  Serial.println(">>> Agendando envio WEB (Node-RED): POSSIVEL_QUEDA");
  webPendingType = "POSSIVEL_QUEDA";
  webPendingLocal = local;
  webPendingDevice = dispositivo;
  webSendPending = true;
  setSystemStatus(SYS_ALERT_SENT);
}

void broadcastSensorFailureAlert(String local, String dispositivo) {
  StaticJsonDocument<256> docAlerta;
  docAlerta["type"] = "ALERTA";
  docAlerta["sub_type"] = "FALHA_SENSOR";
  docAlerta["dispositivo"] = dispositivo;
  JsonObject detalhes = docAlerta.createNestedObject("detalhes");
  detalhes["local"] = local;
  docAlerta["timestamp"] = getFormattedTime();
  docAlerta["epoch_ms"] = (uint32_t)millis();
  String jsonAlerta;
  serializeJson(docAlerta, jsonAlerta);
  ws.textAll(jsonAlerta);

  StaticJsonDocument<128> docStatus;
  docStatus["type"] = "DEVICE_STATUS";
  docStatus["deviceId"] = dispositivo;
  docStatus["status"] = "offline";
  String jsonStatus;
  serializeJson(docStatus, jsonStatus);
  ws.textAll(jsonStatus);

  Serial.println(">>> Agendando envio WEB (Node-RED): FALHA_SENSOR");
  webPendingType = "FALHA_SENSOR";
  webPendingLocal = local;
  webPendingDevice = dispositivo;
  webSendPending = true;
  setSystemStatus(SYS_ALERT_SENT);
}

// Função Renomeada: Processa a fila de envio para o Webhook Node-RED
void processarFilaAlertas() {
  if (webSendPending) {
    String t = webPendingType;
    String l = webPendingLocal;
    String d = webPendingDevice;
    webSendPending = false;
    enviarAlertaNodeRED(t, l, d);
    if (!logPending) setSystemStatus(SYS_ONLINE);
  }
}

void triggerFactoryReset() {
  Serial.println("\n>>> RESET DE FABRICA INICIADO <<<");
  setSystemStatus(SYS_ERROR);
  processLedStatus();

  // 1. Limpa configurações do Servidor (ID, NodeRed, etc)
  preferences.begin("server-config", false);
  preferences.clear();
  preferences.end();

  // 2. CORREÇÃO: Limpa o Histórico Multi-WiFi (Slots 0, 1, 2)
  preferences.begin("wifi-history", false);
  preferences.clear();
  preferences.end();

  // 3. Limpa configurações internas do WiFiManager
  WiFiManager wm;
  wm.resetSettings();

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  Serial.println("TUDO APAGADO (Config + WiFi). Reiniciando...");
  delay(3000);
  ESP.restart();
}

void handleButton() {
  int reading = digitalRead(BUTTON_PIN);
  if (reading != lastButtonState) { lastDebounceTime = millis(); }
  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading != buttonState) {
      buttonState = reading;
      if (buttonState == LOW) {
        buttonPressStartTime = millis();
        longPressActionTaken = false;
        Serial.println("Botao BOOT pressionado...");
      } else {
        unsigned long pressDuration = millis() - buttonPressStartTime;
        if (!longPressActionTaken) {
          // Clique Curto (entre 0.1s e 5s)
          if (pressDuration < 5000 && pressDuration > 100) {
            Serial.println("\n>>> ACAO: Reiniciando Sistema... <<<");
            logSystemCrash("ACAO: Reinicio manual via botao fisico.");
            delay(1000);
            ESP.restart();
          }
        }
      }
    }
  }
  // Clique Longo (> 5s) -> Reset de Fábrica (Mantido)
  if (buttonState == LOW && !longPressActionTaken) {
    if (millis() - buttonPressStartTime > longPressDuration) {
      longPressActionTaken = true;
      triggerFactoryReset();
    }
  }
  lastButtonState = reading;
}

void processPendingLogs() {
  if (logPending) {
    logEvent(pendingCategory, pendingSeverity, pendingSource, pendingMessage);
    logPending = false;
  }
}

void enviarStatusServidor() {
  if (millis() - ultimoPing > pingInterval) {
    StaticJsonDocument<512> doc;
    doc["type"] = "DEVICE_STATUS";
    doc["deviceId"] = deviceId;
    doc["status"] = "online";
    doc["uptimeSec"] = (long)(millis() / 1000);
    doc["rssiDbm"] = (int)WiFi.RSSI();
    doc["heapB"] = (long)ESP.getFreeHeap();
    doc["ip"] = WiFi.localIP().toString();

    String json;
    serializeJson(doc, json);
    ws.textAll(json);
    ultimoPing = millis();
  }
}

// [FASE 3] Watchdog de Conectividade
// Justificativa (Premissa 1.1): Reinicia o hardware se a stack WiFi travar por muito tempo.
// Evita que o servidor fique "zumbi" (ligado mas incomunicável).
void checkConnectionWatchdog() {
  if (WiFi.status() == WL_CONNECTED) {
    lastConnectionTime = millis();
  } else {
    // Se passar do tempo limite desconectado, força reinício
    if (millis() - lastConnectionTime > connectionTimeoutMs) {
      logSystemCrash("ERRO CRITICO: Timeout de Conexao WiFi. Reiniciando...");
      delay(1000);
      ESP.restart();
    }
  }
}

// Função Renomeada: Envia alerta para Node-RED Webhook
void enviarAlertaNodeRED(String tipoAlerta, String local, String dispositivo) {
  bool success = false;
  int attempts = 0;
  const int maxAttempts = 3;

  String mensagem;
  if (tipoAlerta == "QUEDA") mensagem = "Queda CONFIRMADA em " + local + ". Dispositivo: " + dispositivo;
  else if (tipoAlerta == "PANICO") mensagem = "Botão de pânico acionado. Dispositivo: " + dispositivo;
  else if (tipoAlerta == "GAS") mensagem = "Alerta de GAS detectado em " + local + ". Dispositivo: " + dispositivo;
  else if (tipoAlerta == "FUMACA") mensagem = "Alerta de FUMACA detectado em " + local + ". Dispositivo: " + dispositivo;
  else if (tipoAlerta == "POSSIVEL_QUEDA") mensagem = "ATENÇÃO: Possível queda (Sensor Único) em " + local + ". Verifique.";
  else if (tipoAlerta == "FALHA_SENSOR") mensagem = "MANUTENÇÃO: Sensor parou de responder em " + local + ". Dispositivo: " + dispositivo;
  else mensagem = "Alerta de " + tipoAlerta + " detectado. Dispositivo: " + dispositivo;

  StaticJsonDocument<512> doc;
  doc["type"] = tipoAlerta;
  doc["message"] = mensagem;
  // Estrutura compatível com Node-RED Flow
  JsonObject detalhes = doc.createNestedObject("detalhes");
  detalhes["local"] = local;
  doc["deviceId"] = dispositivo;

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  while (!success && attempts < maxAttempts) {
    esp_task_wdt_reset();
    processLedStatus();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("Sem WiFi! Aguardando...");
      delay(500);
      attempts++;
      continue;
    }

    WiFiClient client;
    HTTPClient http;

    // Timeout aumentado para suportar Docker (15s)
    client.setTimeout(15000);

    Serial.print("Enviando Node-RED (" + nodeRedUrl + "): ");
    if (http.begin(client, nodeRedUrl)) {
      http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
      http.addHeader("Content-Type", "application/json");

      http.setTimeout(15000);

      int httpResponseCode = http.POST(jsonPayload);
      if (httpResponseCode > 0) {
        Serial.printf("Resp: %d\n", httpResponseCode);
        if (httpResponseCode == 200) {
          success = true;
        } else {
          Serial.printf("Erro HTTP (Body): %s\n", http.getString().c_str());
          attempts++;
        }
      } else {
        Serial.printf("Erro Conexão: %s\n", http.errorToString(httpResponseCode).c_str());
        client.stop();
        attempts++;
      }
      http.end();
    } else {
      Serial.println("Falha ao iniciar HTTP Client");
      attempts++;
    }

    if (!success) delay(2000);
  }

  if (!success) {
    Serial.println("Falha definitiva no envio Node-RED.");
    logEvent("SYSTEM", "WARNING", "NodeRED", ("Falha no envio de alerta " + tipoAlerta).c_str());
  }
}

void initDatabase() {
  Serial.println("Inicializando banco de dados...");

  // Tenta abrir. Se falhar, tenta recriar.
  if (sqlite3_open(db_path, &db) != SQLITE_OK) {
    SD_MMC.remove(db_path);  // Remove se estiver corrompido
    if (sqlite3_open(db_path, &db) != SQLITE_OK) {
      Serial.println("Falha critica ao abrir DB");
      return;
    }
  }

  // 1. Tabela Users (Padrão)
  db_exec(db, "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password TEXT, name TEXT, role TEXT, email TEXT);");

  // 2. Tabela Devices (NOVA ESTRUTURA v46 - Sem device_id, usa id, name, type, ip...)
  db_exec(db, "CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT, type TEXT, ip TEXT, last_seen INTEGER);");

  // 3. Tabela Timeline (NOVA v46 - Logs Unificados)
  const char *sqlTimeline = "CREATE TABLE IF NOT EXISTS timeline ("
                            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                            "timestamp TEXT, "
                            "category TEXT, "
                            "severity TEXT, "
                            "source TEXT, "
                            "description TEXT);";
  db_exec(db, sqlTimeline);

  // 4. Tabelas Legadas (Compatibilidade)
  db_exec(db, "CREATE TABLE IF NOT EXISTS elderly_data (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, bed_time TEXT, wake_time TEXT, medication_time TEXT, age INTEGER);");
  db_exec(db, "CREATE TABLE IF NOT EXISTS caregivers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT, relation TEXT);");

  Serial.println("Banco de Dados Iniciado");
}

void handleLogin(AsyncWebServerRequest *request) {
  if (request->hasParam("email", true) && request->hasParam("password", true)) {
    String email = request->getParam("email", true)->value();
    String password = request->getParam("password", true)->value();

    // MODO EMERGÊNCIA (Se SD falhou)
    if (!isCardMounted) {
      if (email == "admin" && password == "123") {
        request->send(200, "application/json", "{\"status\":\"success\",\"user\":{\"id\":999,\"name\":\"Admin Emergencia\",\"email\":\"admin\"}}");
        return;
      }
      request->send(401, "application/json", "{\"status\":\"error\",\"message\":\"Erro SD: Login bloqueado\"}");
      return;
    }

    sqlite3_stmt *stmt;
    const char *sql = "SELECT id, name FROM users WHERE email = ? AND password = ?";
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
      // USAR SQLITE_TRANSIENT
      sqlite3_bind_text(stmt, 1, email.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, password.c_str(), -1, SQLITE_TRANSIENT);

      if (sqlite3_step(stmt) == SQLITE_ROW) {
        int id = sqlite3_column_int(stmt, 0);
        String name = (const char *)sqlite3_column_text(stmt, 1);
        String jsonResponse = "{\"status\":\"success\",\"user\":{\"id\":" + String(id) + ",\"name\":\"" + name + "\",\"email\":\"" + email + "\"}}";
        request->send(200, "application/json", jsonResponse);
      } else {
        request->send(401, "application/json", "{\"status\":\"error\",\"message\":\"Credenciais Invalidas\"}");
      }
    } else {
      request->send(500, "application/json", "{\"status\":\"error\",\"message\":\"Erro DB\"}");
    }
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Faltando parametros\"}");
  }
}

// NOVA FUNÇÃO DE LOG (FASE 1) - Grava na Timeline
void logEvent(String category, String severity, String source, String description) {
  if (!isCardMounted || ESP.getFreeHeap() < 30000) {
    if (severity == "CRITICAL") logSystemCrash(category + ": " + description);
    return;
  }
  sqlite3_stmt *stmt;
  const char *sql = "INSERT INTO timeline (timestamp, category, severity, source, description) VALUES (?, ?, ?, ?, ?);";
  if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) return;

  String timeStr = getFormattedTime();
  sqlite3_bind_text(stmt, 1, timeStr.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 2, category.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 3, severity.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 4, source.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 5, description.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_step(stmt);
  sqlite3_finalize(stmt);
  Serial.printf("[LOG v48] %s: %s\n", category.c_str(), description.c_str());
}

void handleUserResetPassword(AsyncWebServerRequest *request) {
  if (request->hasParam("email", true) && request->hasParam("password", true)) {
    String email = request->getParam("email", true)->value();
    String password = request->getParam("password", true)->value();
    sqlite3_stmt *stmt;
    const char *sql = "UPDATE users SET password = ? WHERE email = ?;";
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
      sqlite3_bind_text(stmt, 1, password.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, email.c_str(), -1, SQLITE_TRANSIENT);
      if (sqlite3_step(stmt) == SQLITE_DONE && sqlite3_changes(db) > 0) {
        request->send(200, "application/json", "{\"status\":\"success\"}");
      } else {
        request->send(404, "application/json", "{\"status\":\"error\", \"message\":\"E-mail nao encontrado.\"}");
      }
    } else {
      request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Erro no servidor.\"}");
    }
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Parametros faltando.\"}");
  }
}

void handleUsersGet(AsyncWebServerRequest *request) {
  if (!isCardMounted) {
    // Retorna lista vazia para o app não travar
    request->send(200, "application/json", "[]");
    return;
  }
  String jsonResponse = "[";
  sqlite3_stmt *stmt;
  const char *sql = "SELECT id, name, email FROM users ORDER BY name;";
  if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) {
    request->send(500, "application/json", "{\"error\":\"DB Error\"}");
    return;
  }
  bool first = true;
  while (sqlite3_step(stmt) == SQLITE_ROW) {
    if (!first) jsonResponse += ",";
    first = false;
    jsonResponse += "{\"id\":" + String(sqlite3_column_int(stmt, 0)) + ",\"name\":\"" + String((const char *)sqlite3_column_text(stmt, 1)) + "\",\"email\":\"" + String((const char *)sqlite3_column_text(stmt, 2)) + "\"}";
  }
  jsonResponse += "]";
  sqlite3_finalize(stmt);
  request->send(200, "application/json", jsonResponse);
}

void handleUserAdd(AsyncWebServerRequest *request) {
  // [CORREÇÃO] Proteção contra falta de SD (Evita Crash)
  if (!isCardMounted) {
    request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Erro SD: Cadastro indisponivel\"}");
    return;
  }

  if (request->hasParam("name", true) && request->hasParam("email", true) && request->hasParam("password", true)) {
    sqlite3_stmt *stmt;
    const char *sql = "INSERT INTO users (name, email, password) VALUES (?, ?, ?);";
    
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
      sqlite3_bind_text(stmt, 1, request->getParam("name", true)->value().c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, request->getParam("email", true)->value().c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 3, request->getParam("password", true)->value().c_str(), -1, SQLITE_TRANSIENT);
      
      if (sqlite3_step(stmt) == SQLITE_DONE) {
        request->send(200, "application/json", "{\"status\":\"success\"}");
      } else {
        request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Falha ao inserir (Email duplicado?)\"}");
      }
    } else {
      // Se cair aqui após apagar o DB, é bug crítico de hardware ou memória
      request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Erro SQL Prepare (Verifique SD)\"}");
    }
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Dados incompletos\"}");
  }
}

void handleUserUpdate(AsyncWebServerRequest *request) {
  if (request->hasParam("id", true) && request->hasParam("name", true) && request->hasParam("email", true)) {
    String id = request->getParam("id", true)->value();
    String name = request->getParam("name", true)->value();
    String email = request->getParam("email", true)->value();
    sqlite3_stmt *stmt;
    bool update_pass = request->hasParam("password", true) && request->getParam("password", true)->value().length() > 0;
    String sql_str = "UPDATE users SET name = ?, email = ? ";
    if (update_pass) sql_str += ", password = ? ";
    sql_str += "WHERE id = ?;";
    sqlite3_prepare_v2(db, sql_str.c_str(), -1, &stmt, NULL);
    sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, email.c_str(), -1, SQLITE_TRANSIENT);
    if (update_pass) {
      sqlite3_bind_text(stmt, 3, request->getParam("password", true)->value().c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int(stmt, 4, id.toInt());
    } else {
      sqlite3_bind_int(stmt, 3, id.toInt());
    }
    if (sqlite3_step(stmt) == SQLITE_DONE) request->send(200, "application/json", "{\"status\":\"success\"}");
    else request->send(500, "application/json", "{\"status\":\"error\"}");
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\"}");
  }
}

void handleUserDelete(AsyncWebServerRequest *request) {
  if (request->hasParam("id", true)) {
    sqlite3_stmt *stmt;
    const char *sql = "DELETE FROM users WHERE id = ?;";
    sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
    sqlite3_bind_int(stmt, 1, request->getParam("id", true)->value().toInt());
    if (sqlite3_step(stmt) == SQLITE_DONE) request->send(200, "application/json", "{\"status\":\"success\"}");
    else request->send(500, "application/json", "{\"status\":\"error\"}");
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\"}");
  }
}

void handleElderlyGet(AsyncWebServerRequest *request) {
  if (!isCardMounted) {
    // Retorna lista vazia para o app não travar
    request->send(200, "application/json", "[]");
    return;
  }
  String jsonResponse = "{}";
  sqlite3_stmt *stmt;
  const char *sql = "SELECT name, age, family_contact_name, family_contact_phone, observations FROM elderly_data WHERE id = 1;";
  if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
    if (sqlite3_step(stmt) == SQLITE_ROW) {
      auto get_text = [&](int col) {
        return (const char *)sqlite3_column_text(stmt, col);
      };
      jsonResponse = "{";
      jsonResponse += "\"id\":1,";
      jsonResponse += "\"name\":\"" + String(get_text(0) ? get_text(0) : "") + "\",";
      jsonResponse += "\"age\":" + String(sqlite3_column_int(stmt, 1)) + ",";
      jsonResponse += "\"family_contact_name\":\"" + String(get_text(2) ? get_text(2) : "") + "\",";
      jsonResponse += "\"family_contact_phone\":\"" + String(get_text(3) ? get_text(3) : "") + "\",";
      jsonResponse += "\"observations\":\"" + String(get_text(4) ? get_text(4) : "") + "\"";
      jsonResponse += "}";
    }
  }
  sqlite3_finalize(stmt);
  request->send(200, "application/json", jsonResponse);
}

void handleElderlyAdd(AsyncWebServerRequest *request) {
  if (request->hasParam("name", true) && request->hasParam("age", true) && request->hasParam("family_contact_name", true) && request->hasParam("family_contact_phone", true)) {
    String name = request->getParam("name", true)->value();
    String age = request->getParam("age", true)->value();
    String contact_name = request->getParam("family_contact_name", true)->value();
    String contact_phone = request->getParam("family_contact_phone", true)->value();
    String observations = request->hasParam("observations", true) ? request->getParam("observations", true)->value() : "";
    const char *sql = "INSERT INTO elderly_data (id, name, age, family_contact_name, family_contact_phone, observations) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, age=excluded.age, family_contact_name=excluded.family_contact_name, family_contact_phone=excluded.family_contact_phone, observations=excluded.observations;";
    sqlite3_stmt *stmt;
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
      sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int(stmt, 2, age.toInt());
      sqlite3_bind_text(stmt, 3, contact_name.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 4, contact_phone.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 5, observations.c_str(), -1, SQLITE_TRANSIENT);
      if (sqlite3_step(stmt) == SQLITE_DONE) request->send(200, "application/json", "{\"status\":\"success\"}");
      else request->send(500, "application/json", "{\"status\":\"error\"}");
    } else request->send(500, "application/json", "{\"status\":\"error\"}");
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\"}");
  }
}

void handleElderlyUpdate(AsyncWebServerRequest *request) {
  if (request->hasParam("id", true) && request->hasParam("name", true) && request->hasParam("age", true) && request->hasParam("family_contact_name", true) && request->hasParam("family_contact_phone", true)) {
    String id = request->getParam("id", true)->value();
    String name = request->getParam("name", true)->value();
    String age = request->getParam("age", true)->value();
    String contact_name = request->getParam("family_contact_name", true)->value();
    String contact_phone = request->getParam("family_contact_phone", true)->value();
    String observations = request->hasParam("observations", true) ? request->getParam("observations", true)->value() : "";
    const char *sql = "UPDATE elderly_data SET name = ?, age = ?, family_contact_name = ?, family_contact_phone = ?, observations = ? WHERE id = ?;";
    sqlite3_stmt *stmt;
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
      sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int(stmt, 2, age.toInt());
      sqlite3_bind_text(stmt, 3, contact_name.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 4, contact_phone.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 5, observations.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int(stmt, 6, id.toInt());
      if (sqlite3_step(stmt) == SQLITE_DONE) request->send(200, "application/json", "{\"status\":\"success\"}");
      else request->send(500, "application/json", "{\"status\":\"error\"}");
    } else request->send(500, "application/json", "{\"status\":\"error\"}");
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\"}");
  }
}

void handleCaregiversGet(AsyncWebServerRequest *request) {
  // Proteção contra falha do SD
  if (!isCardMounted) {
    request->send(200, "application/json", "[]");
    return;
  }

  String jsonResponse = "[";
  sqlite3_stmt *stmt;
  const char *sql = "SELECT id, name, phone, relation FROM caregivers;";

  if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) {
    request->send(500, "application/json", "{\"error\":\"DB Error\"}");
    return;
  }

  bool first = true;
  while (sqlite3_step(stmt) == SQLITE_ROW) {
    if (!first) jsonResponse += ",";
    first = false;

    // Constrói JSON manualmente para economizar memória
    jsonResponse += "{\"id\":" + String(sqlite3_column_int(stmt, 0)) + ",";
    jsonResponse += "\"name\":\"" + String((const char *)sqlite3_column_text(stmt, 1)) + "\",";
    jsonResponse += "\"phone\":\"" + String((const char *)sqlite3_column_text(stmt, 2)) + "\",";
    jsonResponse += "\"relation\":\"" + String((const char *)sqlite3_column_text(stmt, 3)) + "\"}";
  }
  jsonResponse += "]";

  sqlite3_finalize(stmt);
  request->send(200, "application/json", jsonResponse);
}

void handleCaregiversAdd(AsyncWebServerRequest *request) {
  if (!isCardMounted) {
    request->send(500, "json", "{\"error\":\"No SD\"}");
    return;
  }

  if (request->hasParam("name", true) && request->hasParam("phone", true)) {
    String name = request->getParam("name", true)->value();
    String phone = request->getParam("phone", true)->value();
    String relation = request->hasParam("relation", true) ? request->getParam("relation", true)->value() : "";

    sqlite3_stmt *stmt;
    const char *sql = "INSERT INTO caregivers (name, phone, relation) VALUES (?, ?, ?);";

    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
      sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, phone.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 3, relation.c_str(), -1, SQLITE_TRANSIENT);

      if (sqlite3_step(stmt) == SQLITE_DONE) request->send(200, "application/json", "{\"status\":\"success\"}");
      else request->send(500, "application/json", "{\"status\":\"error\"}");
    } else {
      request->send(500, "application/json", "{\"status\":\"error\"}");
    }
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing params\"}");
  }
}

void handleCaregiversUpdate(AsyncWebServerRequest *request) {
  // Proteção de Emergência
  if (!isCardMounted) {
    request->send(500, "application/json", "{\"error\":\"No SD\"}");
    return;
  }

  // Verifica se recebeu ID, Nome e Telefone
  if (request->hasParam("id", true) && request->hasParam("name", true) && request->hasParam("phone", true)) {
    String id = request->getParam("id", true)->value();
    String name = request->getParam("name", true)->value();
    String phone = request->getParam("phone", true)->value();
    String relation = request->hasParam("relation", true) ? request->getParam("relation", true)->value() : "";

    sqlite3_stmt *stmt;
    const char *sql = "UPDATE caregivers SET name = ?, phone = ?, relation = ? WHERE id = ?;";

    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
      sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, phone.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 3, relation.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int(stmt, 4, id.toInt());

      if (sqlite3_step(stmt) == SQLITE_DONE) {
        request->send(200, "application/json", "{\"status\":\"success\"}");
      } else {
        request->send(500, "application/json", "{\"status\":\"error\",\"message\":\"Falha no Update\"}");
      }
    } else {
      request->send(500, "application/json", "{\"status\":\"error\",\"message\":\"Erro SQL\"}");
    }
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\",\"message\":\"Faltando parametros\"}");
  }
}

// [FASE 2] Handler TIMELINE (Leitura / Query)
// Implementa o padrão de leitura da Arquitetura CQRS/Event Sourcing.
// Justificativa (Premissa 1.1 e 2.2): Garante que o App receba a "Fonte Única da Verdade" (Timeline).
// Utiliza Fail-Fast para cartão SD e limita resultados para garantir disponibilidade da thread.
void handleTimelineGet(AsyncWebServerRequest *request) {
  // 1. Verificação de Segurança
  if (!isCardMounted) {
    request->send(200, "application/json", "[]");
    return;
  }

  // 2. Inicia o Stream de Resposta (A "Torneira")
  // Isso evita ter que alocar buffers gigantes na memória RAM
  AsyncResponseStream *response = request->beginResponseStream("application/json");
  response->addHeader("Access-Control-Allow-Origin", "*"); 

  // 3. Query Direta (Sem filtros, para ver tudo)
  const char *sql = "SELECT id, timestamp, category, severity, source, description FROM timeline ORDER BY id DESC LIMIT 50;";
  sqlite3_stmt *stmt;
  
  if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) {
    logSystemCrash("ERRO DB: Falha prepare timeline");
    request->send(500, "application/json", "{\"error\":\"DB Error\"}");
    return;
  }

  // 4. Construção do JSON Linha a Linha
  response->print("["); // Abre a lista
  bool first = true;
  
  while (sqlite3_step(stmt) == SQLITE_ROW) {
    if (!first) response->print(","); // Vírgula entre itens
    first = false;
    
    // Pequeno buffer apenas para A LINHA ATUAL (Super leve: ~512 bytes)
    StaticJsonDocument<512> rowDoc;
    
    // Extração e Tratamento Automático de Caracteres (Aspas, acentos, etc)
    rowDoc["id"] = sqlite3_column_int(stmt, 0);
    
    const char* val;
    val = (const char*)sqlite3_column_text(stmt, 1); rowDoc["timestamp"] = val ? val : "";
    val = (const char*)sqlite3_column_text(stmt, 2); rowDoc["category"] = val ? val : "INFO";
    val = (const char*)sqlite3_column_text(stmt, 3); rowDoc["severity"] = val ? val : "INFO";
    val = (const char*)sqlite3_column_text(stmt, 4); rowDoc["source"] = val ? val : "Server";
    val = (const char*)sqlite3_column_text(stmt, 5); rowDoc["description"] = val ? val : "";
    
    // Serializa esta linha diretamente para o fluxo de rede
    serializeJson(rowDoc, *response);
  }
  
  response->print("]"); // Fecha a lista
  sqlite3_finalize(stmt);
  
  // Envia tudo
  request->send(response);
}

// [FASE 2] Handler ACKNOWLEDGE (Escrita / Auditoria)
// Implementa o padrão de Auditoria Imutável.
// Justificativa (Premissa 3.1): Em sistemas críticos, o histórico nunca deve ser alterado (UPDATE).
// Registra-se um novo evento confirmando a ciência, preservando a evidência original.
void handleAcknowledgeAlert(AsyncWebServerRequest *request) {
  // Validação de entrada estrita
  if (request->hasParam("id", true) && request->hasParam("user", true)) {
    String refId = request->getParam("id", true)->value();
    String user = request->getParam("user", true)->value();

    // Sanitização: A função logEvent utiliza bindings internos ou formatação segura.
    logEvent("SYSTEM", "INFO", user, "Confirmou ciencia do evento ID: " + refId);

    request->send(200, "application/json", "{\"status\":\"success\"}");
  } else {
    request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Missing params\"}");
  }
}

int db_exec(sqlite3 *db, const char *sql) {
  char *zErrMsg = 0;
  int rc = sqlite3_exec(db, sql, 0, 0, &zErrMsg);
  if (rc != SQLITE_OK) {
    Serial.printf("SQL error: %s\n", zErrMsg);
    sqlite3_free(zErrMsg);
  }
  return rc;
}

void setupWebSocket() {
  ws.onEvent(onEvent);
  server.addHandler(&ws);
}

// [FASE 3] Gerenciador de Eventos Wi-Fi (Resiliente)
// Justificativa (Premissa 1.1): Implementa reconexão não-bloqueante via Ticker.
void WiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    if (!logPending) {
      pendingCategory = "SYSTEM";
      pendingSeverity = "WARNING";
      pendingSource = "WiFi_Manager";
      pendingMessage = "Conexao Wi-Fi perdida. Tentando reconectar...";
      logPending = true;
    }
    setSystemStatus(SYS_CONNECTING);
    // Agenda reconexão para daqui a 2 segundos (Backoff simples)
    wifiReconnectTimer.once(2, []() {
      WiFi.reconnect();
    });
  } else if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
    setSystemStatus(SYS_ONLINE);
    lastConnectionTime = millis();  // Reseta o watchdog
    wifiReconnectTimer.detach();    // Cancela agendamentos pendentes
    if (!logPending) {
      pendingCategory = "SYSTEM";
      pendingSeverity = "INFO";
      pendingSource = "WiFi_Manager";
      pendingMessage = "Conexao restabelecida! IP: " + WiFi.localIP().toString();
      logPending = true;
    }
  }
}

String getFormattedTime() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return "NO_TIME_DATA";
  char timeString[50];
  strftime(timeString, sizeof(timeString), "%Y-%m-%d %H:%M:%S", &timeinfo);
  return String(timeString);
}

// --- Funções de Gerenciamento de Dispositivos (HTTP) ---
// Callbacks Dispositivos
static int selectDevicesCallback(void *data, int argc, char **argv, char **azColName) {
  JsonArray *devicesArray = (JsonArray *)data;
  JsonObject device = devicesArray->createNestedObject();
  for (int i = 0; i < argc; i++) {
    // Mapeia colunas do banco (id, type) para o JSON esperado pelo App (deviceId, deviceType)
    if (strcmp(azColName[i], "id") == 0) device["deviceId"] = argv[i] ? argv[i] : "";
    else if (strcmp(azColName[i], "type") == 0) device["deviceType"] = argv[i] ? argv[i] : "";
  }
  return 0;
}

void handleDevicesGet(AsyncWebServerRequest *request) {
  DynamicJsonDocument doc(1024);
  JsonArray devicesArray = doc.to<JsonArray>();
  // CORREÇÃO: Colunas id e type (v46)
  const char *sql = "SELECT id, type FROM devices;";
  char *zErrMsg = 0;
  int rc = sqlite3_exec(db, sql, selectDevicesCallback, &devicesArray, &zErrMsg);
  if (rc != SQLITE_OK) {
    sqlite3_free(zErrMsg);
    request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Database error\"}");
    return;
  }
  String responseJson;
  serializeJson(devicesArray, responseJson);
  request->send(200, "application/json", responseJson);
}

void handleDevicesSet(AsyncWebServerRequest *request) {
  if (request->hasParam("deviceId", true) && request->hasParam("type", true)) {
    String deviceId = request->getParam("deviceId", true)->value();
    String deviceType = request->getParam("type", true)->value();
    sqlite3_stmt *stmt;
    int rc;
    // CORREÇÃO: Colunas type e id
    const char *sql_update = "UPDATE devices SET type = ? WHERE id = ?;";
    rc = sqlite3_prepare_v2(db, sql_update, -1, &stmt, 0);
    if (rc != SQLITE_OK) {
      request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"DB Error Update\"}");
      return;
    }
    sqlite3_bind_text(stmt, 1, deviceType.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, deviceId.c_str(), -1, SQLITE_TRANSIENT);
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (sqlite3_changes(db) == 0) {
      // CORREÇÃO: Insert com id e type
      const char *sql_insert = "INSERT INTO devices (id, type) VALUES (?, ?);";
      rc = sqlite3_prepare_v2(db, sql_insert, -1, &stmt, 0);
      if (rc != SQLITE_OK) {
        request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"DB Error Insert\"}");
        return;
      }
      sqlite3_bind_text(stmt, 1, deviceId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, deviceType.c_str(), -1, SQLITE_TRANSIENT);
      rc = sqlite3_step(stmt);
      sqlite3_finalize(stmt);
    }
    request->send(200, "application/json", "{\"status\":\"success\"}");
  } else {
    request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Missing deviceId or type parameter\"}");
  }
}

void handleDevicesDelete(AsyncWebServerRequest *request) {
  if (request->hasParam("deviceId", true)) {
    String deviceId = request->getParam("deviceId", true)->value();
    // CORREÇÃO: Coluna id
    const char *sql = "DELETE FROM devices WHERE id = ?;";
    sqlite3_stmt *stmt;
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, 0);
    if (rc != SQLITE_OK) {
      request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"DB Error\"}");
      return;
    }
    sqlite3_bind_text(stmt, 1, deviceId.c_str(), -1, SQLITE_TRANSIENT);
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    request->send(200, "application/json", "{\"status\":\"success\"}");
  } else {
    request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Missing deviceId parameter\"}");
  }
}

void saveNetworkToHistory() {
  String currentSSID = WiFi.SSID();
  String currentPass = WiFi.psk();
  if (currentSSID.length() == 0) return;
  preferences.begin("wifi-history", false);
  String s0 = preferences.getString("s0", "");
  if (currentSSID == s0) {
    preferences.end();
    return;
  }
  preferences.putString("s2", preferences.getString("s1", ""));
  preferences.putString("p2", preferences.getString("p1", ""));
  preferences.putString("s1", s0);
  preferences.putString("p1", preferences.getString("p0", ""));
  preferences.putString("s0", currentSSID);
  preferences.putString("p0", currentPass);
  preferences.end();
  Serial.println("Nova rede salva no historico Multi-WiFi: " + currentSSID);
}

// [NOVO v43] Grava logs críticos diretamente em TXT (bypass do SQLite)
void logSystemCrash(String mensagem) {
  // Abre em modo append para não perder histórico anterior
  File file = SD_MMC.open("/sys_log.txt", FILE_APPEND);
  if (!file) {
    Serial.println("ERRO CRITICO: Falha ao gravar no /sys_log.txt");
    return;
  }

  String timeStr = getFormattedTime();
  if (timeStr == "NO_TIME_DATA") timeStr = String(millis());

  // Formato: [DATA] (Memoria) MENSAGEM
  file.printf("[%s] (Free: %d) %s\n", timeStr.c_str(), ESP.getFreeHeap(), mensagem.c_str());
  file.close();

  // Espelho na Serial para debug imediato
  Serial.printf("[LOG SD] %s\n", mensagem.c_str());
}

void saveConfig() {
  preferences.begin("server-config", false);
  preferences.putString("deviceId", deviceId);
  preferences.putString("nodeRedUrl", nodeRedUrl);
  preferences.putInt("timezone", timezone);
  preferences.putString("otaPass", otaPass);
  preferences.putInt("wdtTimeout", wdtTimeout);
  preferences.putInt("wmTimeout", wmTimeout);
  preferences.putULong("pingInterval", pingInterval);
  preferences.end();
  Serial.println("Configuracoes salvas via saveConfig()!");
}
