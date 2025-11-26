// v25 - Versão Servidor Central (Atualização de Broadcast)
// - Adicionados novos tipos de alerta: POSSIVEL_QUEDA e FALHA_SENSOR.
// - Funções de broadcast atualizadas para notificar App e Vercel corretamente.
// - Mantida compatibilidade com clientes antigos.

#include <WiFi.h>
#include <WiFiManager.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include "time.h"
#include "SPI.h"
#include "SD.h"
#include <sqlite3.h>
#include "esp_task_wdt.h"
#include <map>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// --- CONFIGURAÇÕES ---
const int SD_CS_PIN = 5;
const int BACKUP_BUTTON_PIN = 27;
const char *ntpServer = "pool.ntp.org";
const long gmtOffset_sec = -10800;  // GMT-3
const int daylightOffset_sec = 0;
const int WDT_TIMEOUT_S = 10;
const char *vercelServerUrl = "https://vercel-arpa3i.vercel.app/api/alert";

// --- VARIÁVEIS GLOBAIS ---
const char *myApiKey = "f4b3c2d1-a6e5-4f78-9b9c-8e0d3a2b1c0f-arpa3i";  // Sua chave de API
AsyncWebServer server(86);
AsyncWebSocket ws("/ws");
std::map<uint32_t, String> clientDeviceIds;
std::map<String, String> childGatewayMap;  // <--- ADICIONE ISTO (Mapeia Filho -> Pai)
unsigned long ultimoPing = 0;

// --- VARIÁVEIS PARA LOG DE ALERTA ASSÍNCRONO ---
volatile bool alertPending = false;
String pendingAlertType;
String pendingAlertMessage;
volatile bool g_broadcastPending = false;
String g_broadcastMessage;

// --- VARIÁVEIS GLOBAIS ADICIONAIS ---
bool cloudServerAvailable = true;
int failedCloudConnections = 0;
const int maxFailedConnections = 5;

// --- CONFIGURAÇÕES DO BANCO DE DADOS E BACKUP ---
sqlite3 *db;
const char *db_path = "/sd/arpa3i_data.db";
const char *db_backup_path = "/sd/arpa3i_data.db.bak";
unsigned long last_backup_time = 0;
const unsigned long backup_interval = 3600000;  // 1 hora

// --- CONTROLE DO BOTÃO DE BACKUP ---
int buttonState = HIGH;
int lastBackupButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const long debounceDelay = 50;

// --- PROTÓTIPOS ---
void setupWebSocket();
void enviarPing();
void initDatabase();
void handleUserResetPassword(AsyncWebServerRequest *request);
void logAlert(const char *alertType, const char *message);
void handleAlertLogging();
void handleBackupButton();
void handleBroadcasts();
String getFormattedTime();
void WiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info);
void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len);
int db_exec(sqlite3 *db, const char *sql);
bool copyFile(const char *srcPath, const char *destPath);
void performBackup();
void handleBackup();
void handleLogin(AsyncWebServerRequest *request);
void handleUsersGet(AsyncWebServerRequest *request);
void handleUserAdd(AsyncWebServerRequest *request);
void handleUserUpdate(AsyncWebServerRequest *request);
void handleUserDelete(AsyncWebServerRequest *request);
void handleElderlyGet(AsyncWebServerRequest *request);
void handleElderlyAdd(AsyncWebServerRequest *request);
void handleElderlyUpdate(AsyncWebServerRequest *request);
void handleDevicesGet(AsyncWebServerRequest *request);
void handleDevicesSet(AsyncWebServerRequest *request);
void handleDevicesDelete(AsyncWebServerRequest *request);
void handleAlertsGet(AsyncWebServerRequest *request);
void handleAcknowledgeAlert(AsyncWebServerRequest *request);
void broadcastFallAlert(String local, String dispositivo);
void broadcastPanicAlert(String dispositivo);
void broadcastGasAlert(String local, String dispositivo);
void broadcastSmokeAlert(String local, String dispositivo);
// NOVOS PROTÓTIPOS v25
void broadcastPossibleFallAlert(String local, String dispositivo);
void broadcastSensorFailureAlert(String local, String dispositivo);
// ---
bool acknowledgeLatestAlert(String user);
void sendAckToClient(AsyncWebSocketClient *client, const char *alertType);
void enviarAlertaVercel(String tipoAlerta, String local, String dispositivo);
String urlEncode(String str);
bool testCloudConnection();
void resetFailedConnectionCounter();


void wifiManagerCallback(WiFiManager *myWiFiManager) {
  Serial.println("Entrou no modo de configuracao do AP... alimentando o watchdog.");
  //esp_task_wdt_reset();
}

void setup() {
  Serial.begin(115200);
  pinMode(BACKUP_BUTTON_PIN, INPUT_PULLUP);

  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("Falha na inicializacao do Cartao SD!");
    while (1)
      ;
  }
  Serial.println("Cartao SD inicializado.");
  initDatabase();
  WiFi.onEvent(WiFiEvent);

  WiFiManager wm;
  wm.setAPCallback(wifiManagerCallback);
  wm.setConfigPortalTimeout(180);
  if (!wm.autoConnect("ServidorArpa3iAP")) {
    Serial.println("Falha ao conectar e o tempo de configuração expirou. Reiniciando...");
    delay(3000);
    ESP.restart();
  }
  Serial.println("\nConectado ao Wi-Fi!");
  delay(500);
  Serial.println("IP: " + WiFi.localIP().toString());

  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  Serial.println("Aguardando sincronizacao do NTP...");
  struct tm timeinfo;
  long startTime = millis();
  const long ntpTimeout = 10000;
  while ((!getLocalTime(&timeinfo) || timeinfo.tm_year < 120) && (millis() - startTime < ntpTimeout)) {
    delay(100);
  }

  if (millis() - startTime >= ntpTimeout) {
    Serial.println("Timeout! Nao foi possivel sincronizar o NTP.");
    logAlert("ERRO_NTP", "Falha ao sincronizar NTP na inicializacao");
  } else {
    Serial.println("NTP sincronizado com sucesso.");
    logAlert("INFO", ("Sistema iniciado. IP: " + WiFi.localIP().toString()).c_str());
  }

  setupWebSocket();
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");

  server.on("/login", HTTP_POST, handleLogin);
  server.on("/users", HTTP_GET, handleUsersGet);
  server.on("/users/add", HTTP_POST, handleUserAdd);
  server.on("/users/update", HTTP_POST, handleUserUpdate);
  server.on("/users/delete", HTTP_POST, handleUserDelete);
  server.on("/users/reset-password", HTTP_POST, handleUserResetPassword);
  server.on("/elderly", HTTP_GET, handleElderlyGet);
  server.on("/elderly/add", HTTP_POST, handleElderlyAdd);
  server.on("/elderly/update", HTTP_POST, handleElderlyUpdate);
  server.on("/alerts", HTTP_GET, handleAlertsGet);
  server.on("/acknowledge", HTTP_POST, handleAcknowledgeAlert);

  // --- Rotas de Gerenciamento de Dispositivos ---
  server.on("/devices", HTTP_GET, handleDevicesGet);
  server.on("/devices/set", HTTP_POST, handleDevicesSet);
  server.on("/devices/delete", HTTP_POST, handleDevicesDelete);

  // --- Configuração CORS ---
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");
  server.begin();
  Serial.println("\n--- Servidor Arpa3i v25 Iniciado ---");

  esp_task_wdt_config_t wdt_config = { .timeout_ms = (uint32_t)(WDT_TIMEOUT_S * 1000), .trigger_panic = true };
  esp_task_wdt_init(&wdt_config);
  esp_task_wdt_add(NULL);
}

void loop() {
  esp_task_wdt_reset();
  enviarPing();
  handleAlertLogging();
  handleBackup();
  handleBackupButton();
  handleBroadcasts();
  ws.cleanupClients();
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
    Serial.printf("%s conectado. Aguardando ID personalizado...\n", genericId.c_str());
  } else if (type == WS_EVT_DISCONNECT) {
    String deviceId = clientDeviceIds[client->id()];
    Serial.printf("Dispositivo '%s' desconectado.\n", deviceId.c_str());
    String json = "{\"type\":\"DEVICE_STATUS\",\"deviceId\":\"" + deviceId + "\",\"status\":\"offline\"}";
    ws.textAll(json);

    if (!deviceId.startsWith("Cliente #")) {
      String logMsg = "Dispositivo principal desconectado: " + deviceId;
      logAlert("FALHA_SENSOR", logMsg.c_str());
      broadcastSensorFailureAlert("Conexao WebSocket perdida", deviceId);
      
      for (auto const &[child, parent] : childGatewayMap) {
        if (parent == deviceId) {
          Serial.printf(">>> CASCATA: O pai '%s' caiu. Derrubando o filho '%s'...\n", deviceId.c_str(), child.c_str());

          // 1. Envia status offline para o App (atualiza a bolinha)
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

  } else if (type == WS_EVT_DATA) {
    AwsFrameInfo *info = (AwsFrameInfo *)arg;
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
      data[len] = 0;
      StaticJsonDocument<1024> doc;
      if (deserializeJson(doc, (char *)data).code() == DeserializationError::Ok) {

        const char *type_msg_check = doc["type"] | "";  // Verifica o tipo primeiro

        if (doc.containsKey("deviceId") && strcmp(type_msg_check, "DEVICE_STATUS") == 0) {
          String deviceId = doc["deviceId"];
          if (clientDeviceIds[client->id()] != deviceId) {
            Serial.printf("Cliente #%u ('%s') identificado como '%s'.\n", client->id(), clientDeviceIds[client->id()].c_str(), deviceId.c_str());
            clientDeviceIds[client->id()] = deviceId;
            // Emite ONLINE para qualquer tipo de dispositivo ao identificar o deviceId
            String json = "{\"type\":\"DEVICE_STATUS\",\"deviceId\":\"" + deviceId + "\",\"status\":\"online\"}";
            ws.textAll(json);
          }
        }

        const char *type_msg = type_msg_check;  // Reutiliza a variável
        String deviceId = clientDeviceIds[client->id()];

        if (strcmp(type_msg, "ALERTA") == 0) {
          if (doc.containsKey("deviceId")) {
            deviceId = doc["deviceId"].as<String>();
          }
          const char *sub_type = doc["sub_type"] | "";
          JsonObject detalhes = doc["detalhes"];
          String local = detalhes["local"] | "desconhecido";

          if (strcmp(sub_type, "PANICO") == 0) {
            String logMsg = "Botao de panico acionado por: " + deviceId;
            Serial.printf("--- ALERTA DE PÂNICO recebido de '%s' ---\n", deviceId.c_str());
            logAlert("PANICO", logMsg.c_str());
            sendAckToClient(client, "PANICO");
            broadcastPanicAlert(deviceId);

          } else if (strcmp(sub_type, "QUEDA") == 0) {
            String logMsg = "Queda CONFIRMADA por: " + deviceId + " (" + local + ")";
            Serial.printf("--- ALERTA DE QUEDA recebido de '%s', sensor [%s] ---\n", deviceId.c_str(), local.c_str());
            logAlert("QUEDA", logMsg.c_str());
            sendAckToClient(client, "QUEDA");
            broadcastFallAlert(local, deviceId);

          } else if (strcmp(sub_type, "GAS") == 0) {
            String logMsg = "GAS detectado por: " + deviceId + " (" + local + ")";
            Serial.printf("--- ALERTA DE GAS recebido de '%s', sensor [%s] ---\n", deviceId.c_str(), local.c_str());
            logAlert("GAS", logMsg.c_str());
            sendAckToClient(client, "GAS");
            broadcastGasAlert(local, deviceId);

          } else if (strcmp(sub_type, "FUMACA") == 0) {
            String logMsg = "FUMACA detectada por: " + deviceId + " (" + local + ")";
            Serial.printf("--- ALERTA DE FUMACA recebido de '%s', sensor [%s] ---\n", deviceId.c_str(), local.c_str());
            logAlert("FUMACA", logMsg.c_str());
            sendAckToClient(client, "FUMACA");
            broadcastSmokeAlert(local, deviceId);

            // --- NOVOS TIPOS v25 (Suporte ao Gateway S3) ---
          } else if (strcmp(sub_type, "POSSIVEL_QUEDA") == 0) {
            String logMsg = "Possivel Queda (Sensor Unico): " + deviceId + " (" + local + ")";
            Serial.printf("--- ALERTA: POSSIVEL QUEDA de '%s' em [%s] ---\n", deviceId.c_str(), local.c_str());
            logAlert("POSSIVEL_QUEDA", logMsg.c_str());
            sendAckToClient(client, "POSSIVEL_QUEDA");
            broadcastPossibleFallAlert(local, deviceId);

          } else if (strcmp(sub_type, "FALHA_SENSOR") == 0) {
            String logMsg = "Sensor Offline/Falha: " + deviceId + " (" + local + ")";
            Serial.printf("--- ALERTA: FALHA SENSOR '%s' em [%s] ---\n", deviceId.c_str(), local.c_str());
            logAlert("FALHA_SENSOR", logMsg.c_str());
            // Geralmente não precisa de ACK para aviso de falha de sensor remoto,
            // mas ajuda o Gateway a saber que o servidor registrou o erro.
            sendAckToClient(client, "FALHA_SENSOR");
            broadcastSensorFailureAlert(local, deviceId);
          }
        } else if (strcmp(type_msg, "ACK_ALERTA") == 0) {
          Serial.printf("--- Recebida confirmacao de ciencia de '%s' ---\n", deviceId.c_str());
          if (!acknowledgeLatestAlert(deviceId)) {
            String logMsg = "Usuario [" + deviceId + "] confirmou ciencia de um alerta.";
            logAlert("ALERTA_CIENTE", logMsg.c_str());
          }
        } else if (strcmp(type_msg, "HEARTBEAT") == 0) {
          JsonObject hbData = doc["data"];
          long uptime_ms = hbData["uptime_ms"] | 0L;
          int reconnects = hbData["reconnects"] | 0;
          int tensao_mV = hbData["tensao_mV"] | -1;
          float temp_cpu_c = hbData["temp_cpu_c"] | 0.0f;
          long free_heap_b = hbData["free_heap_b"] | 0L;
          int wifi_rssi_dbm = hbData["wifi_rssi_dbm"] | 0;

          StaticJsonDocument<256> out;
          out["type"] = "DEVICE_STATUS";
          out["deviceId"] = deviceId;
          out["status"] = "online";
          if (tensao_mV >= 0) out["batteryMv"] = tensao_mV;
          out["uptimeSec"] = (long)(uptime_ms / 1000);
          out["reconnects"] = reconnects;
          if (wifi_rssi_dbm != 0) out["rssiDbm"] = wifi_rssi_dbm;
          if (free_heap_b != 0) out["heapB"] = free_heap_b;
          if (temp_cpu_c != 0.0f) out["tempCpuC"] = temp_cpu_c;
          String jsonOut;
          serializeJson(out, jsonOut);
          ws.textAll(jsonOut);
        } else if (strcmp(type_msg, "DEVICE_STATUS") == 0) {
          // Cliente envia diretamente no formato consumido pelo app.
          // Garante o deviceId mapeado e repassa campos esperados.
          StaticJsonDocument<256> out;
          out["type"] = "DEVICE_STATUS";
          out["deviceId"] = deviceId;  // sempre o mapeado
          const char *status = doc["status"] | "online";
          out["status"] = status;
          if (doc.containsKey("batteryMv")) out["batteryMv"] = (int)doc["batteryMv"];
          if (doc.containsKey("uptimeSec")) out["uptimeSec"] = (long)doc["uptimeSec"];
          if (doc.containsKey("reconnects")) out["reconnects"] = (int)doc["reconnects"];
          if (doc.containsKey("rssiDbm")) out["rssiDbm"] = (int)doc["rssiDbm"];
          if (doc.containsKey("heapB")) out["heapB"] = (long)doc["heapB"];
          if (doc.containsKey("tempCpuC")) out["tempCpuC"] = (float)doc["tempCpuC"];
          String jsonOut;
          serializeJson(out, jsonOut);
          ws.textAll(jsonOut);
        } else if (strcmp(type_msg, "REMOTE_TELEMETRY") == 0) {
          // Esta é uma telemetria de um dispositivo filho (ex: ESP-01)
          // vinda através de um gateway (ex: S3).
          // Nós NÃO atualizamos o clientDeviceIds aqui (para parar o spam).
          // Apenas normalizamos e retransmitimos para os apps.
          String childId = doc["deviceId"].as<String>();     // "sdq_auxiliar"
          String gatewayId = clientDeviceIds[client->id()];  // "SDQ_ARPA3I" (Pega do mapa de conexão)

          // Se ainda não mapeamos ou mudou de pai, salva agora
          if (childGatewayMap[childId] != gatewayId) {
            childGatewayMap[childId] = gatewayId;
            Serial.printf(">>> MAPEAMENTO: '%s' registrado como dependente de '%s'\n", childId.c_str(), gatewayId.c_str());
          }
          Serial.printf("Retransmitindo telemetria remota de '%s'\n", doc["deviceId"].as<String>().c_str());

          StaticJsonDocument<256> out;
          out["type"] = "DEVICE_STATUS";  // O app espera DEVICE_STATUS
          out["deviceId"] = doc["deviceId"];
          out["status"] = doc["status"] | "online";
          if (doc.containsKey("batteryMv")) out["batteryMv"] = (int)doc["batteryMv"];
          if (doc.containsKey("uptimeSec")) out["uptimeSec"] = (long)doc["uptimeSec"];
          if (doc.containsKey("rssiDbm")) out["rssiDbm"] = (int)doc["rssiDbm"];
          if (doc.containsKey("heapB")) out["heapB"] = (long)doc["heapB"];

          String jsonOut;
          serializeJson(out, jsonOut);
          ws.textAll(jsonOut);  // Envia para todos os apps conectados
        } else if (strcmp(type_msg, "SYSTEM_BROADCAST") == 0) {
          // Se vier um DEVICE_STATUS do cliente, converte em um evento DEVICE_STATUS normalizado
          JsonObject dataObj = doc["data"];
          const char *btype = dataObj["broadcast_type"] | "";
          if (strcmp(btype, "DEVICE_STATUS") == 0) {
            JsonObject sd = dataObj["status_data"];
            int tensao_mV = sd["tensao_mV"] | -1;
            long uptime_ms = sd["uptime_ms"] | 0L;
            int reconnects = sd["reconnects"] | 0;

            StaticJsonDocument<200> out;
            out["type"] = "DEVICE_STATUS";
            out["deviceId"] = deviceId;
            out["status"] = "online";
            if (tensao_mV >= 0) out["batteryMv"] = tensao_mV;
            out["uptimeSec"] = (long)(uptime_ms / 1000);
            out["reconnects"] = reconnects;
            String jsonOut;
            serializeJson(out, jsonOut);
            ws.textAll(jsonOut);
          } else {
            String jsonBroadcast = (char *)data;
            ws.textAll(jsonBroadcast);
          }
        }
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
  String json;
  serializeJson(doc, json);
  ws.textAll(json);
  Serial.printf("\n>>> BROADCAST DE QUEDA (Padronizado): Local=[%s], Dispositivo=[%s] <<<\n", local.c_str(), dispositivo.c_str());

  enviarAlertaVercel("QUEDA", local, dispositivo);
}

void broadcastPanicAlert(String dispositivo) {
  StaticJsonDocument<200> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = "PANICO";
  doc["dispositivo"] = dispositivo;
  String json;
  serializeJson(doc, json);
  ws.textAll(json);
  Serial.printf("\n>>> BROADCAST DE PÂNICO (Padronizado): Dispositivo=[%s] <<<\n", dispositivo.c_str());

  enviarAlertaVercel("PANICO", "", dispositivo);
}

void broadcastGasAlert(String local, String dispositivo) {
  StaticJsonDocument<200> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = "GAS";
  doc["dispositivo"] = dispositivo;
  JsonObject detalhes = doc.createNestedObject("detalhes");
  detalhes["local"] = local;
  String json;
  serializeJson(doc, json);
  ws.textAll(json);
  Serial.printf("\n>>> BROADCAST DE GAS (Padronizado): Local=[%s], Dispositivo=[%s] <<<\n", local.c_str(), dispositivo.c_str());

  enviarAlertaVercel("GAS", local, dispositivo);
}

void broadcastSmokeAlert(String local, String dispositivo) {
  StaticJsonDocument<200> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = "FUMACA";
  doc["dispositivo"] = dispositivo;
  JsonObject detalhes = doc.createNestedObject("detalhes");
  detalhes["local"] = local;
  String json;
  serializeJson(doc, json);
  ws.textAll(json);
  Serial.printf("\n>>> BROADCAST DE FUMACA (Padronizado): Local=[%s], Dispositivo=[%s] <<<\n", local.c_str(), dispositivo.c_str());

  enviarAlertaVercel("FUMACA", local, dispositivo);
}

// =========================================================================
// NOVAS FUNÇÕES (v25): Broadcast de Possível Queda e Falha de Sensor
// =========================================================================
void broadcastPossibleFallAlert(String local, String dispositivo) {
  StaticJsonDocument<256> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = "POSSIVEL_QUEDA";  // Novo subtipo para o App
  doc["dispositivo"] = dispositivo;
  JsonObject detalhes = doc.createNestedObject("detalhes");
  detalhes["local"] = local;
  String json;
  serializeJson(doc, json);
  ws.textAll(json);
  Serial.printf("\n>>> BROADCAST POSSIVEL QUEDA: Local=[%s], Disp=[%s] <<<\n", local.c_str(), dispositivo.c_str());

  enviarAlertaVercel("POSSIVEL_QUEDA", local, dispositivo);
}

void broadcastSensorFailureAlert(String local, String dispositivo) {
  // --- Mensagem 1: O ALERTA (para a notificação push) ---
  StaticJsonDocument<256> docAlerta;
  docAlerta["type"] = "ALERTA";
  docAlerta["sub_type"] = "FALHA_SENSOR";
  docAlerta["dispositivo"] = dispositivo;
  JsonObject detalhes = docAlerta.createNestedObject("detalhes");
  detalhes["local"] = local;
  String jsonAlerta;
  serializeJson(docAlerta, jsonAlerta);
  ws.textAll(jsonAlerta);
  Serial.printf("\n>>> BROADCAST FALHA SENSOR: Local=[%s], Disp=[%s] <<<\n", local.c_str(), dispositivo.c_str());

  // --- Mensagem 2: O STATUS (para atualizar a UI do app) ---
  // (Esta é a parte nova que você precisa)
  StaticJsonDocument<128> docStatus;
  docStatus["type"] = "DEVICE_STATUS";
  docStatus["deviceId"] = dispositivo;  // "sdq_auxiliar"
  docStatus["status"] = "offline";      // <-- A informação que o app precisa
  String jsonStatus;
  serializeJson(docStatus, jsonStatus);
  ws.textAll(jsonStatus);
  Serial.printf(">>> BROADCAST STATUS: Dispositivo=[%s] set to OFFLINE <<<\n", dispositivo.c_str());

  // --- Envio para Vercel (Push Notification) ---
  enviarAlertaVercel("FALHA_SENSOR", local, dispositivo);
}
// =========================================================================

bool acknowledgeLatestAlert(String user) {
  sqlite3_stmt *stmt;
  const char *sql = "UPDATE alerts SET acknowledged_by = ?, acknowledged_at = ? WHERE id = (SELECT id FROM alerts WHERE (alert_type LIKE '%FUMACA%' OR alert_type LIKE '%GAS%' OR alert_type LIKE '%QUEDA%' OR alert_type LIKE '%PANICO%') AND acknowledged_by IS NULL ORDER BY id DESC LIMIT 1);";
  if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) return false;
  String timestamp = getFormattedTime();
  sqlite3_bind_text(stmt, 1, user.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 2, timestamp.c_str(), -1, SQLITE_TRANSIENT);
  bool success = false;
  if (sqlite3_step(stmt) == SQLITE_DONE && sqlite3_changes(db) > 0) success = true;
  sqlite3_finalize(stmt);
  return success;
}

void handleBackupButton() {
  int reading = digitalRead(BACKUP_BUTTON_PIN);
  if (reading != lastBackupButtonState) { lastDebounceTime = millis(); }
  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading != buttonState) {
      buttonState = reading;
      if (buttonState == LOW) {
        Serial.println("\n>>> BOTAO DE BACKUP PRESSIONADO. FORCANDO EXECUCAO. <<<");
        performBackup();
      }
    }
  }
  lastBackupButtonState = reading;
}

void handleAlertLogging() {
  if (alertPending) {
    String typeToLog = pendingAlertType;
    String messageToLog = pendingAlertMessage;
    alertPending = false;
    logAlert(typeToLog.c_str(), messageToLog.c_str());
  }
}

void handleBroadcasts() {
  if (g_broadcastPending) {
    Serial.println(">>> Retransmitindo SYSTEM_BROADCAST (do loop): " + g_broadcastMessage);
    ws.textAll(g_broadcastMessage);

    // Limpa a fila
    g_broadcastMessage = "";
    g_broadcastPending = false;
  }
}

void enviarPing() {
  if (millis() - ultimoPing > 10000) {
    // Envia um frame de DADOS (string)
    ws.textAll("{\"type\":\"ping\"}");
    ultimoPing = millis();
  }
}

void enviarAlertaVercel(String tipoAlerta, String local, String dispositivo) {
  HTTPClient http;
  WiFiClientSecure client;

  bool success = false;
  int attempts = 0;
  const int maxAttempts = 3;

  String mensagem;
  if (tipoAlerta == "QUEDA") {
    mensagem = "Queda CONFIRMADA em " + local + ". Dispositivo: " + dispositivo;
  } else if (tipoAlerta == "PANICO") {
    mensagem = "Botão de pânico acionado. Dispositivo: " + dispositivo;
  } else if (tipoAlerta == "GAS") {
    mensagem = "Alerta de GAS detectado em " + local + ". Dispositivo: " + dispositivo;
  } else if (tipoAlerta == "FUMACA") {
    mensagem = "Alerta de FUMACA detectado em " + local + ". Dispositivo: " + dispositivo;
    // --- NOVOS CASOS v25 ---
  } else if (tipoAlerta == "POSSIVEL_QUEDA") {
    mensagem = "ATENÇÃO: Possível queda (Sensor Único) em " + local + ". Verifique imediatamente. Dispositivo: " + dispositivo;
  } else if (tipoAlerta == "FALHA_SENSOR") {
    mensagem = "MANUTENÇÃO: Sensor parou de responder em " + local + ". Dispositivo: " + dispositivo;
  } else {
    mensagem = "Alerta de " + tipoAlerta + " detectado. Dispositivo: " + dispositivo;
  }

  while (!success && attempts < maxAttempts) {

    StaticJsonDocument<512> doc;
    doc["type"] = tipoAlerta;
    doc["message"] = mensagem;
    String jsonPayload;
    serializeJson(doc, jsonPayload);

    Serial.print("Enviando alerta para Vercel (tentativa " + String(attempts + 1) + "): ");
    Serial.println(vercelServerUrl);
    Serial.print("Payload: ");
    Serial.println(jsonPayload);

    client.setInsecure();
    http.begin(client, vercelServerUrl);
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-API-Key", myApiKey);

    int httpResponseCode = http.POST(jsonPayload);

    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.print("Resposta do servidor: ");
      Serial.println(httpResponseCode);
      Serial.println(response);

      if (httpResponseCode == 200) {
        success = true;
      } else {
        attempts++;
      }

    } else {
      Serial.print("Erro no envio do alerta. Código de erro: ");
      Serial.println(httpResponseCode);
      attempts++;
    }

    http.end();
    delay(1000);
  }

  if (!success) {
    Serial.println("Falha após todas as tentativas de envio do alerta.");
    logAlert("ERRO_ENVIO", ("Falha no envio de alerta " + tipoAlerta).c_str());
  }
}


String urlEncode(String str) {
  String encodedString = "";
  char c;
  char code0;
  char code1;
  for (int i = 0; i < str.length(); i++) {
    c = str.charAt(i);
    if (c == ' ') {
      encodedString += '+';
    } else if (isalnum(c)) {
      encodedString += c;
    } else {
      code1 = (c & 0xf) + '0';
      if ((c & 0xf) > 9) {
        code1 = (c & 0xf) - 10 + 'A';
      }
      c = (c >> 4) & 0xf;
      code0 = c + '0';
      if (c > 9) {
        code0 = c - 10 + 'A';
      }
      encodedString += '%';
      encodedString += code0;
      encodedString += code1;
    }
  }
  return encodedString;
}

bool testCloudConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi desconectado. Não é possível testar conexão com servidor.");
    return false;
  }

  WiFiClientSecure client;
  HTTPClient http;

  String testUrl = String(vercelServerUrl);
  testUrl.replace("/api/alert", "/api/");
  Serial.print("Testando conexão com servidor (rota GET /api/): ");
  Serial.println(testUrl);

  client.setInsecure();

  http.begin(client, testUrl);
  http.setTimeout(5000);
  // Timeout de 5 segundos
  int httpResponseCode = http.GET();
  bool success = (httpResponseCode == 200);
  if (success) {
    Serial.print("Conexão com servidor bem-sucedida. Código: ");
    Serial.println(httpResponseCode);
    String response = http.getString();
    Serial.println("Resposta: " + response);
    resetFailedConnectionCounter();
  } else {
    Serial.print("Falha na conexão com servidor. Erro: ");
    Serial.println(httpResponseCode);
    failedCloudConnections++;

    if (failedCloudConnections >= maxFailedConnections) {
      cloudServerAvailable = false;
      Serial.println("Servidor em nuvem marcado como indisponível após falhas consecutivas.");
      logAlert("ERRO_SERVIDOR", "Servidor em nuvem indisponível após múltiplas falhas");
    }
  }

  http.end();
  return success;
}

void resetFailedConnectionCounter() {
  if (failedCloudConnections > 0) {
    failedCloudConnections = 0;
    if (!cloudServerAvailable) {
      cloudServerAvailable = true;
      Serial.println("Servidor em nuvem marcado como disponível novamente.");
      logAlert("INFO", "Conexão com servidor em nuvem restaurada");
    }
  }
}

bool copyFile(const char *srcPath, const char *destPath) {
  File srcFile = SD.open(srcPath, FILE_READ);
  if (!srcFile) return false;
  if (SD.exists(destPath)) SD.remove(destPath);
  File destFile = SD.open(destPath, FILE_WRITE);
  if (!destFile) {
    srcFile.close();
    return false;
  }
  uint8_t buf[512];
  size_t bytesRead;
  while ((bytesRead = srcFile.read(buf, sizeof(buf))) > 0) {
    destFile.write(buf, bytesRead);
    esp_task_wdt_reset();
  }
  srcFile.close();
  destFile.close();
  return true;
}

void performBackup() {
  Serial.println("Iniciando rotina de backup do banco de dados...");
  sqlite3_close(db);
  delay(100);
  bool backup_success = false;
  for (int i = 0; i < 5; i++) {
    if (copyFile(db_path, db_backup_path)) {
      backup_success = true;
      break;
    }
    delay(300);
  }
  if (backup_success) Serial.println("Backup do banco de dados concluido com sucesso.");
  else Serial.println("Falha ao criar o backup do banco de dados apos multiplas tentativas.");
  if (sqlite3_open(db_path, &db)) Serial.printf("CRITICO: Nao foi possivel reabrir o banco de dados: %s\n", sqlite3_errmsg(db));
  else Serial.println("Banco de dados reaberto com sucesso.");
  last_backup_time = millis();
}

void handleBackup() {
  if (millis() - last_backup_time > backup_interval) {
    performBackup();
  }
}

void initDatabase() {
  Serial.println("Inicializando banco de dados...");

  bool create_new_db = false;
  if (sqlite3_open(db_path, &db) != SQLITE_OK) {
    sqlite3_close(db);
    if (SD.exists(db_backup_path) && copyFile(db_backup_path, db_path)) {
      if (sqlite3_open(db_path, &db) != SQLITE_OK) create_new_db = true;
    } else create_new_db = true;
  }
  if (create_new_db) {
    SD.remove(db_path);
    sqlite3_open(db_path, &db);
  }

  const char *sql_devices = "CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, device_type TEXT NOT NULL);";
  if (db_exec(db, sql_devices) != SQLITE_OK) {
    Serial.println("ERRO: Falha ao criar tabela devices.");
    return;
  }
  Serial.println("Tabela 'devices' verificada/criada.");

  db_exec(db, "CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, alert_type TEXT NOT NULL, message TEXT NOT NULL, acknowledged_by TEXT, acknowledged_at TEXT);");
  db_exec(db, "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);");
  if (db_exec(db, "CREATE TABLE IF NOT EXISTS elderly_data (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT, age INTEGER, family_contact_name TEXT, family_contact_phone TEXT, observations TEXT);") == SQLITE_OK) {
    db_exec(db, "INSERT OR IGNORE INTO elderly_data (id) VALUES (1);");
  }

  if (create_new_db) {
    sqlite3_close(db);
    copyFile(db_path, db_backup_path);
    sqlite3_open(db_path, &db);
    last_backup_time = millis();
  }
  Serial.println("Banco de dados e tabelas prontos.");
}

void handleLogin(AsyncWebServerRequest *request) {
  if (request->hasParam("email", true) && request->hasParam("password", true)) {
    String email = request->getParam("email", true)->value();
    String password = request->getParam("password", true)->value();
    sqlite3_stmt *stmt;
    const char *sql = "SELECT id, name FROM users WHERE email = ? AND password = ?;";
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
      sqlite3_bind_text(stmt, 1, email.c_str(), -1, SQLITE_STATIC);
      sqlite3_bind_text(stmt, 2, password.c_str(), -1, SQLITE_STATIC);
      if (sqlite3_step(stmt) == SQLITE_ROW) {
        String jsonResponse = "{\"status\":\"success\",\"user\":{\"id\":" + String(sqlite3_column_int(stmt, 0)) + ",\"name\":\"" + String((const char *)sqlite3_column_text(stmt, 1)) + "\",\"email\":\"" + email + "\"}}";
        request->send(200, "application/json", jsonResponse);
      } else {
        request->send(401, "application/json", "{\"status\":\"error\", \"message\":\"E-mail ou senha invalidos.\"}");
      }
    } else {
      request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Erro no servidor.\"}");
    }
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Parametros faltando.\"}");
  }
}

void handleUserResetPassword(AsyncWebServerRequest *request) {
  if (request->hasParam("email", true) && request->hasParam("password", true)) {
    String email = request->getParam("email", true)->value();
    String password = request->getParam("password", true)->value();
    sqlite3_stmt *stmt;
    const char *sql = "UPDATE users SET password = ? WHERE email = ?;";
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
      sqlite3_bind_text(stmt, 1, password.c_str(), -1, SQLITE_STATIC);
      sqlite3_bind_text(stmt, 2, email.c_str(), -1, SQLITE_STATIC);
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
  if (request->hasParam("name", true) && request->hasParam("email", true) && request->hasParam("password", true)) {
    sqlite3_stmt *stmt;
    const char *sql = "INSERT INTO users (name, email, password) VALUES (?, ?, ?);";
    sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
    sqlite3_bind_text(stmt, 1, request->getParam("name", true)->value().c_str(), -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 2, request->getParam("email", true)->value().c_str(), -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 3, request->getParam("password", true)->value().c_str(), -1, SQLITE_STATIC);
    if (sqlite3_step(stmt) == SQLITE_DONE) request->send(200, "application/json", "{\"status\":\"success\"}");
    else request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Email pode ja existir\"}");
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Missing params\"}");
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
    sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 2, email.c_str(), -1, SQLITE_STATIC);
    if (update_pass) {
      sqlite3_bind_text(stmt, 3, request->getParam("password", true)->value().c_str(), -1, SQLITE_STATIC);
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
      sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_STATIC);
      sqlite3_bind_int(stmt, 2, age.toInt());
      sqlite3_bind_text(stmt, 3, contact_name.c_str(), -1, SQLITE_STATIC);
      sqlite3_bind_text(stmt, 4, contact_phone.c_str(), -1, SQLITE_STATIC);
      sqlite3_bind_text(stmt, 5, observations.c_str(), -1, SQLITE_STATIC);
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
      sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_STATIC);
      sqlite3_bind_int(stmt, 2, age.toInt());
      sqlite3_bind_text(stmt, 3, contact_name.c_str(), -1, SQLITE_STATIC);
      sqlite3_bind_text(stmt, 4, contact_phone.c_str(), -1, SQLITE_STATIC);
      sqlite3_bind_text(stmt, 5, observations.c_str(), -1, SQLITE_STATIC);
      sqlite3_bind_int(stmt, 6, id.toInt());
      if (sqlite3_step(stmt) == SQLITE_DONE) request->send(200, "application/json", "{\"status\":\"success\"}");
      else request->send(500, "application/json", "{\"status\":\"error\"}");
    } else request->send(500, "application/json", "{\"status\":\"error\"}");
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\"}");
  }
}

void handleAlertsGet(AsyncWebServerRequest *request) {
  String sql = "SELECT id, timestamp, alert_type, message, acknowledged_by, acknowledged_at FROM alerts ";
  if (request->hasParam("status")) {
    String status = request->getParam("status")->value();
    if (status == "pending") sql += "WHERE acknowledged_by IS NULL ";
    else if (status == "acknowledged") sql += "WHERE acknowledged_by IS NOT NULL ";
  }
  sql += "ORDER BY id DESC LIMIT 100;";
  String jsonResponse = "[";
  sqlite3_stmt *stmt;
  if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, NULL) != SQLITE_OK) {
    request->send(500, "application/json", "{\"error\":\"DB Error\"}");
    return;
  }
  bool first = true;
  while (sqlite3_step(stmt) == SQLITE_ROW) {
    if (!first) jsonResponse += ",";
    first = false;
    jsonResponse += "{";
    jsonResponse += "\"id\":" + String(sqlite3_column_int(stmt, 0)) + ",";
    jsonResponse += "\"timestamp\":\"" + String((const char *)sqlite3_column_text(stmt, 1)) + "\",";
    jsonResponse += "\"alert_type\":\"" + String((const char *)sqlite3_column_text(stmt, 2)) + "\",";
    jsonResponse += "\"message\":\"" + String((const char *)sqlite3_column_text(stmt, 3)) + "\",";
    const char *ack_by = (const char *)sqlite3_column_text(stmt, 4);
    jsonResponse += "\"acknowledged_by\":" + (ack_by ? "\"" + String(ack_by) + "\"" : "null") + ",";
    const char *ack_at = (const char *)sqlite3_column_text(stmt, 5);
    jsonResponse += "\"acknowledged_at\":" + (ack_at ? "\"" + String(ack_at) + "\"" : "null");
    jsonResponse += "}";
  }
  jsonResponse += "]";
  sqlite3_finalize(stmt);
  request->send(200, "application/json", jsonResponse);
}

void handleAcknowledgeAlert(AsyncWebServerRequest *request) {
  if (request->hasParam("id", true) && request->hasParam("user", true)) {
    String id = request->getParam("id", true)->value();
    String user = request->getParam("user", true)->value();
    sqlite3_stmt *stmt;
    const char *sql = "UPDATE alerts SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ?;";
    sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
    String timestamp = getFormattedTime();
    sqlite3_bind_text(stmt, 1, user.c_str(), -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 2, timestamp.c_str(), -1, SQLITE_STATIC);
    sqlite3_bind_int(stmt, 3, id.toInt());
    if (sqlite3_step(stmt) == SQLITE_DONE) request->send(200, "application/json", "{\"status\":\"success\"}");
    else request->send(500, "application/json", "{\"status\":\"error\"}");
    sqlite3_finalize(stmt);
  } else {
    request->send(400, "application/json", "{\"status\":\"error\"}");
  }
}


void logAlert(const char *alertType, const char *message) {
  sqlite3_stmt *stmt;
  const char *sql = "INSERT INTO alerts (timestamp, alert_type, message) VALUES (?, ?, ?);";
  if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) return;
  String timestamp = getFormattedTime();
  sqlite3_bind_text(stmt, 1, timestamp.c_str(), -1, SQLITE_STATIC);
  sqlite3_bind_text(stmt, 2, alertType, -1, SQLITE_STATIC);
  sqlite3_bind_text(stmt, 3, message, -1, SQLITE_STATIC);
  sqlite3_step(stmt);
  sqlite3_finalize(stmt);
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

void WiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    if (!alertPending) {
      pendingAlertType = "WIFI";
      pendingAlertMessage = "Conexao Wi-Fi perdida.";
      alertPending = true;
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

struct DeviceInfo {
  String deviceId;
  String deviceType;
};
static int selectDevicesCallback(void *data, int argc, char **argv, char **azColName) {
  JsonArray *devicesArray = (JsonArray *)data;
  JsonObject device = devicesArray->createNestedObject();

  for (int i = 0; i < argc; i++) {
    if (strcmp(azColName[i], "device_id") == 0) {
      device["deviceId"] = argv[i] ? argv[i] : "";
    } else if (strcmp(azColName[i], "device_type") == 0) {
      device["deviceType"] = argv[i] ? argv[i] : "";
    }
  }
  return 0;
}

void handleDevicesGet(AsyncWebServerRequest *request) {
  DynamicJsonDocument doc(1024);
  JsonArray devicesArray = doc.to<JsonArray>();
  const char *sql = "SELECT device_id, device_type FROM devices;";

  char *zErrMsg = 0;
  int rc = sqlite3_exec(db, sql, selectDevicesCallback, &devicesArray, &zErrMsg);

  if (rc != SQLITE_OK) {
    Serial.printf("SQL error in GET /devices: %s\n", zErrMsg);
    sqlite3_free(zErrMsg);
    request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Database error\"}");
    return;
  }

  String responseJson;
  serializeJson(devicesArray, responseJson);
  request->send(200, "application/json", responseJson);
  Serial.printf("GET /devices respondido com %d dispositivos.\n", devicesArray.size());
}

// =========================================================================
// INÍCIO DA CORREÇÃO: Lógica UPSERT Manual
// (Previne o crash "parser stack overflow" do ON CONFLICT)
// =========================================================================
void handleDevicesSet(AsyncWebServerRequest *request) {
  if (request->hasParam("deviceId", true) && request->hasParam("type", true)) {
    String deviceId = request->getParam("deviceId", true)->value();
    String deviceType = request->getParam("type", true)->value();

    sqlite3_stmt *stmt;
    int rc;

    // --- ETAPA 1: Tentar ATUALIZAR (UPDATE) primeiro ---
    const char *sql_update = "UPDATE devices SET device_type = ? WHERE device_id = ?;";
    rc = sqlite3_prepare_v2(db, sql_update, -1, &stmt, 0);

    if (rc != SQLITE_OK) {
      Serial.printf("SQL error (prepare update) in POST /devices/set: %s\n", sqlite3_errmsg(db));
      request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Database prepare error (update)\"}");
      return;
    }

    sqlite3_bind_text(stmt, 1, deviceType.c_str(), -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 2, deviceId.c_str(), -1, SQLITE_STATIC);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);  // Finaliza o statement de update

    if (rc != SQLITE_DONE) {
      Serial.printf("SQL error (execute update) in POST /devices/set: %s\n", sqlite3_errmsg(db));
      request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Database execute error (update)\"}");
      return;
    }

    // --- ETAPA 2: Verificar se algo foi atualizado.
    // Se não, INSERIR (INSERT) ---
    if (sqlite3_changes(db) == 0) {
      // Nenhuma linha foi atualizada, então o deviceId não existe.
      // Vamos inserir.
      Serial.printf("Device '%s' nao encontrado. Inserindo...\n", deviceId.c_str());

      const char *sql_insert = "INSERT INTO devices (device_id, device_type) VALUES (?, ?);";
      rc = sqlite3_prepare_v2(db, sql_insert, -1, &stmt, 0);

      if (rc != SQLITE_OK) {
        Serial.printf("SQL error (prepare insert) in POST /devices/set: %s\n", sqlite3_errmsg(db));
        request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Database prepare error (insert)\"}");
        return;
      }

      sqlite3_bind_text(stmt, 1, deviceId.c_str(), -1, SQLITE_STATIC);
      sqlite3_bind_text(stmt, 2, deviceType.c_str(), -1, SQLITE_STATIC);

      rc = sqlite3_step(stmt);
      sqlite3_finalize(stmt);  // Finaliza o statement de insert

      if (rc != SQLITE_DONE) {
        Serial.printf("SQL error (execute insert) in POST /devices/set: %s\n", sqlite3_errmsg(db));
        request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Database execute error (insert)\"}");
        return;
      }
      Serial.printf("POST /devices/set: Novo device '%s' set to type '%s'.\n", deviceId.c_str(), deviceType.c_str());
    } else {
      Serial.printf("POST /devices/set: Device '%s' atualizado para o tipo '%s'.\n", deviceId.c_str(), deviceType.c_str());
    }

    request->send(200, "application/json", "{\"status\":\"success\"}");
  } else {
    request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Missing deviceId or type parameter\"}");
  }
}
// =========================================================================
// FIM DA CORREÇÃO
// =========================================================================

void handleDevicesDelete(AsyncWebServerRequest *request) {
  if (request->hasParam("deviceId", true)) {
    String deviceId = request->getParam("deviceId", true)->value();
    // 1. Prepara a declaração SQL com placeholder
    const char *sql = "DELETE FROM devices WHERE device_id = ?;";
    sqlite3_stmt *stmt;
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, 0);
    if (rc != SQLITE_OK) {
      Serial.printf("SQL error (prepare) in POST /devices/delete: %s\n", sqlite3_errmsg(db));
      request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Database prepare error\"}");
      return;
    }

    // 2. Vincula o valor
    sqlite3_bind_text(stmt, 1, deviceId.c_str(), -1, SQLITE_STATIC);
    // 3. Executa a declaração
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    // Libera o statement

    if (rc != SQLITE_DONE) {
      Serial.printf("SQL error (execute) in POST /devices/delete: %s\n", sqlite3_errmsg(db));
      request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Database execute error\"}");
      return;
    }

    Serial.printf("POST /devices/delete: Device '%s' deleted.\n", deviceId.c_str());
    request->send(200, "application/json", "{\"status\":\"success\"}");
  } else {
    request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Missing deviceId parameter\"}");
  }
}