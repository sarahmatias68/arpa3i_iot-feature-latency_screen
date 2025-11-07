// v1 - Cliente Detector de Gás e Fumaça
// - Baseado na arquitetura de cliente passivo (v19+ da pulseira).
// - Compatível com o "ping por dados" (string) enviado pelo servidor.
// - Implementa a lógica de detecção dupla (Gás/Fumaça) usando
//   a saída Analógica (A0) e Digital (D5) de um sensor MQ-x.
// - Usa WiFiManager para configuração de IP do servidor e Device ID.
// - Envia heartbeats (DEVICE_STATUS) e responde a solicitações de status.
// - Implementa lógica de ACK e reenvio para alertas.
//
// v1.1 (Correção de Compilação):
// - Adicionadas variáveis globais faltantes para handleButton()
// - Adicionadas constantes faltantes para webSocket.begin() e handleLed()

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <WiFiManager.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

ADC_MODE(ADC_VCC); // Habilita a leitura de tensão (VCC) no pino A0

// --- CONFIGURAÇÕES DE REDE E DISPOSITIVO ---
char ws_host[20] = "192.168.1.6"; // IP padrão do servidor
const uint16_t ws_port = 86; // <<< ADICIONADO (Faltava)
const char* ws_path = "/ws"; // <<< ADICIONADO (Faltava)
char deviceId[40] = "detector_cozinha_1"; // ID padrão

// --- MAPEAMENTO DE PINOS (NodeMCU) ---
const int MQ_AO_PIN = A0;         // Pino Analógico (para Gás)
const int MQ_DO_PIN = D5;         // Pino Digital (para Fumaça) - (GPIO14)
const int LED_PIN = 2;            // LED onboard do NodeMCU (D4 / GPIO2)
const int BUTTON_RESET_PIN = 0;   // Botão "FLASH" do NodeMCU (GPIO0)

// --- LÓGICA DE DETECÇÃO ---
const int GAS_THRESHOLD = 600;
const int HYSTERESIS = 50;
const int SMOKE_TRIGGER_STATE = LOW; 

enum SensorState { STATE_SAFE, STATE_GAS_DETECTED, STATE_SMOKE_DETECTED };
SensorState currentSensorState = STATE_SAFE;
unsigned long lastSensorReadTime = 0;
const long sensorReadInterval = 1000; 

// --- CONTROLE DE ACK E REENVIO ---
volatile bool alertAwaitingAck = false;
unsigned long alertSentTime = 0;
String alertTypeSent = "";
const long RESEND_INTERVAL = 10000; 

// --- ESTADOS DO LED DE STATUS ---
enum LedState { WIFI_CONNECTING, SERVER_DISCONNECTED, SERVER_CONNECTED, AWAITING_ACK, ALERT_ACTIVE };
volatile LedState currentLedState = WIFI_CONNECTING;
unsigned long ledPreviousMillis = 0;
bool ledIsOn = false;
// Constantes para lógica invertida do LED do NodeMCU
const int LED_ON = LOW;
const int LED_OFF = HIGH;

// --- VARIÁVEIS GLOBAIS ---
WebSocketsClient webSocket;
bool isConnected = false;
unsigned long lastHeartbeatTime = 0;
const long heartbeatInterval = 15000; // 15 segundos
unsigned long reconnectCounter = 0;
volatile bool sendInitialHeartbeat = false;

// --- CONTROLE DO BOTÃO E RESET ---
// =========================================================================
// INÍCIO DA CORREÇÃO DE COMPILAÇÃO
// (Estas variáveis faltavam)
// =========================================================================
int buttonState = HIGH; 
int lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const long debounceDelay = 50;
// =========================================================================
// FIM DA CORREÇÃO
// =========================================================================
unsigned long buttonPressStartTime = 0;
bool longPressActionTaken = false; // Renomeado de 'longPressActionTaken' para clareza
const long longPressDuration = 10000; // 10 segundos para reset de fábrica

// --- PROTÓTIPOS ---
void sendHeartbeat();
void saveConfig();
void loadConfig();
void enviarAlerta(String tipo, String valor);
void handleAlertResend();
void verificarSensores();
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length);
void triggerFactoryReset();
void handleButton();
void handleLed();
void wifiManagerCallback(WiFiManager *myWiFiManager);

// Identificação inicial com deviceId para o servidor mapear corretamente
void sendHelloIdentification() {
  if (!isConnected) return;
  StaticJsonDocument<80> doc;
  doc["deviceId"] = deviceId;
  String json; serializeJson(doc, json);
  webSocket.sendTXT(json);
}

// Reseta o dispositivo e limpa o WiFi / EEPROM
void triggerFactoryReset() {
  for(int i=0; i<10; i++) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    delay(100);
  }
  WiFiManager wm;
  wm.resetSettings();
  EEPROM.begin(128);
  for (int i = 0; i < 128; i++) EEPROM.write(i, 0);
  EEPROM.commit();
  EEPROM.end();
  ESP.restart();
}

// Salva o IP do servidor e o Device ID na EEPROM
void saveConfig() {
  EEPROM.begin(128);
  for (int i = 0; i < 40; ++i) EEPROM.write(i, deviceId[i]);
  for (int i = 0; i < 20; ++i) EEPROM.write(i + 40, ws_host[i]);
  EEPROM.commit();
  EEPROM.end();
}

// Carrega o IP do servidor e o Device ID da EEPROM
void loadConfig() {
  EEPROM.begin(128);
  for (int i = 0; i < 40; ++i) deviceId[i] = EEPROM.read(i);
  deviceId[39] = '\0';
  for (int i = 0; i < 20; ++i) ws_host[i] = EEPROM.read(i + 40);
  ws_host[19] = '\0';
  EEPROM.end();
}

void wifiManagerCallback(WiFiManager *myWiFiManager) {
  ESP.wdtFeed();
}

// Envia um alerta (Gás ou Fumaça) para o servidor
void enviarAlerta(String tipo, String valor) {
  // Não envia um novo alerta se já estiver aguardando confirmação
  if (alertAwaitingAck) return;

  if (!isConnected) {
    Serial.println("Alerta pendente. Sem conexao.");
    // (Não definimos 'pending' aqui, pois verificarSensores() tentará de novo no próximo ciclo)
    return;
  }

  StaticJsonDocument<200> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = tipo; // "GAS" ou "FUMACA"
  doc["deviceId"] = deviceId;
  JsonObject detalhes = doc.createNestedObject("detalhes");
  detalhes["local"] = "Cozinha"; // Pode ser configurável se desejar
  if(valor.length() > 0) {
    detalhes["valor"] = valor;
  }
  
  String json;
  serializeJson(doc, json);
  
  webSocket.sendTXT(json);
  
  alertAwaitingAck = true;
  alertSentTime = millis();
  alertTypeSent = tipo;
  currentLedState = AWAITING_ACK;
  Serial.println("Enviando alerta: " + json);
}

// Lida com o reenvio de alertas não confirmados (ACK)
void handleAlertResend() {
  if (alertAwaitingAck && (millis() - alertSentTime > RESEND_INTERVAL)) {
    Serial.println("Nenhum ACK recebido. Reenviando alerta: " + alertTypeSent);
    // Reenvia o alerta
    if(alertTypeSent == "GAS") {
      enviarAlerta("GAS", "Reenvio");
    } else if (alertTypeSent == "FUMACA") {
      enviarAlerta("FUMACA", "Reenvio");
    }
  }
}

// Lógica principal de leitura dos sensores
void verificarSensores() {
  // Lê os sensores apenas no intervalo definido (ex: 1x por segundo)
  if (millis() - lastSensorReadTime < sensorReadInterval) {
    return;
  }
  lastSensorReadTime = millis();

  // Se já estamos aguardando um ACK, não envie novos alertas
  if (alertAwaitingAck) {
    return;
  }

  // --- LEITURA DOS SENSORES ---
  // Fumaça (Digital): Lê o pino DO. Calibre o potenciômetro no módulo!
  bool smokeDetected = (digitalRead(MQ_DO_PIN) == SMOKE_TRIGGER_STATE);
  
  // Gás (Analógico): Lê o pino A0.
  int gasValue = analogRead(MQ_AO_PIN);
  bool gasDetected = (gasValue > GAS_THRESHOLD);
  

  // --- MÁQUINA DE ESTADOS ---
  switch (currentSensorState) {
    case STATE_SAFE:
      if (smokeDetected) {
        // Fumaça tem prioridade máxima
        Serial.printf("FUMACA DETECTADA! (Pino DO: %d)\n", digitalRead(MQ_DO_PIN));
        enviarAlerta("FUMACA", "");
        currentSensorState = STATE_SMOKE_DETECTED;
        currentLedState = ALERT_ACTIVE; // Define o LED para alerta
      } else if (gasDetected) {
        Serial.printf("GAS DETECTADO! (Valor AO: %d)\n", gasValue);
        enviarAlerta("GAS", String(gasValue));
        currentSensorState = STATE_GAS_DETECTED;
        currentLedState = ALERT_ACTIVE; // Define o LED para alerta
      }
      break;

    case STATE_GAS_DETECTED:
      if (smokeDetected) {
        // Se detectar fumaça enquanto detectava gás, "promove" o alerta
        Serial.printf("ALERTA PROMOVIDO PARA FUMACA! (Pino DO: %d)\n", digitalRead(MQ_DO_PIN));
        enviarAlerta("FUMACA", ""); // Envia novo alerta de Fumaça
        currentSensorState = STATE_SMOKE_DETECTED;
      } else if (gasValue < (GAS_THRESHOLD - HYSTERESIS)) {
        // Gás dissipou (usando histerese para evitar oscilação)
        Serial.println("Ambiente seguro (gas dissipou).");
        currentSensorState = STATE_SAFE;
        if(!alertAwaitingAck) { // Só apaga o LED se não estiver esperando ACK
            currentLedState = SERVER_CONNECTED; 
        }
      }
      break;

    case STATE_SMOKE_DETECTED:
      if (!smokeDetected) {
        // Fumaça dissipou (pino digital voltou ao normal)
        Serial.println("Ambiente seguro (fumaca dissipou).");
        currentSensorState = STATE_SAFE;
        if(!alertAwaitingAck) {
            currentLedState = SERVER_CONNECTED;
        }
      }
      break;
  }
}

// Lida com eventos do WebSocket
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      isConnected = false;
      currentLedState = SERVER_DISCONNECTED;
      reconnectCounter++;
      Serial.println("Servidor desconectado!");
      break;
    case WStype_CONNECTED:
      isConnected = true;
      currentLedState = SERVER_CONNECTED;
      sendInitialHeartbeat = true; // Agenda o envio do primeiro heartbeat
      Serial.println("Servidor conectado!");
      // Envia identificação inicial com deviceId
      sendHelloIdentification();
      
      // Se um alerta foi detectado enquanto offline, envia agora
      if(currentSensorState == STATE_GAS_DETECTED) {
        enviarAlerta("GAS", "Pendente");
      } else if (currentSensorState == STATE_SMOKE_DETECTED) {
        enviarAlerta("FUMACA", "Pendente");
      }
      break;
    case WStype_TEXT:
      {
        StaticJsonDocument<300> doc; 
        if (deserializeJson(doc, payload).code() == DeserializationError::Ok) {
          const char* msg_type = doc["type"] | "";
          
          if (strcmp(msg_type, "ACK") == 0) {
            const char* acked_alert = doc["acked_alert"] | "";
            // Verifica se o ACK é para o alerta que enviamos
            if (alertAwaitingAck && strcmp(acked_alert, alertTypeSent.c_str()) == 0) {
              Serial.println("ACK recebido do servidor para: " + alertTypeSent);
              alertAwaitingAck = false;
              alertTypeSent = "";
              // Se o ambiente já está seguro, volta o LED ao normal
              if(currentSensorState == STATE_SAFE) {
                currentLedState = SERVER_CONNECTED;
              }
            }
          }
          else if (strcmp(msg_type, "SYSTEM_BROADCAST") == 0) {
            JsonObject data = doc["data"];
            const char* broadcast_type = data["broadcast_type"] | "";
            
            if (strcmp(broadcast_type, "REQUEST_DEVICE_STATUS") == 0) {
              Serial.println("Solicitacao de status recebida. Respondendo com heartbeat...");
              sendHeartbeat(); 
            }
          }
          else if (strcmp(msg_type, "ping") == 0) {
            Serial.println("Ping de dados (string) recebido do servidor.");
            // Responde imediatamente com heartbeat
            sendHeartbeat();
          }
        }
        break;
      }
    default:
      break;
  }
}

// Lida com o botão de reset de fábrica
void handleButton() {
  int reading = digitalRead(BUTTON_RESET_PIN);
  
  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }
  
  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading != buttonState) {
      buttonState = reading;
      if (buttonState == LOW) {
        buttonPressStartTime = millis();
        longPressActionTaken = false;
      }
    }
  }
  
  if (buttonState == LOW && !longPressActionTaken && (millis() - buttonPressStartTime > longPressDuration)) {
     longPressActionTaken = true; // Evita re-trigger
     triggerFactoryReset();
  }
  lastButtonState = reading;
}

// Lida com o LED de status
void handleLed() {
    unsigned long currentMillis = millis();
    unsigned long interval = 500;

    // Regra: só pisca quando NÃO conectado. Conectado = LED fixo aceso
    switch (currentLedState) {
        case WIFI_CONNECTING:
            interval = 500; // pisca devagar enquanto conecta WiFi
            break;
        case SERVER_DISCONNECTED:
            interval = 150; // pisca rápido se perdeu conexão com o servidor
            break;
        case SERVER_CONNECTED:
        case AWAITING_ACK:
        case ALERT_ACTIVE:
            if (!ledIsOn) {
                digitalWrite(LED_PIN, LED_ON);
                ledIsOn = true;
            }
            return; // conectado: mantém aceso fixo
    }

    if (currentMillis - ledPreviousMillis >= interval) {
        ledPreviousMillis = currentMillis;
        digitalWrite(LED_PIN, !digitalRead(LED_PIN));
        ledIsOn = (digitalRead(LED_PIN) == LED_ON);
    }
}

// Envia o status (heartbeat) para o servidor diretamente como DEVICE_STATUS
void sendHeartbeat() {
  if (!isConnected) return;
  StaticJsonDocument<256> doc;
  doc["type"] = "DEVICE_STATUS";
  doc["deviceId"] = deviceId;
  doc["status"] = "online";
  doc["uptimeSec"] = (long)(millis() / 1000);
  doc["rssiDbm"] = (int)WiFi.RSSI();
  doc["reconnects"] = (int)reconnectCounter;
  doc["heapB"] = (long)ESP.getFreeHeap();
  doc["batteryMv"] = (int)ESP.getVcc();
  // Campos extras (opcionais) para diagnóstico local
  doc["sensorAo"] = analogRead(MQ_AO_PIN);
  doc["sensorDo"] = (digitalRead(MQ_DO_PIN) == SMOKE_TRIGGER_STATE) ? 1 : 0;
  doc["estado"] = (currentSensorState == STATE_SAFE) ? "Seguro" : ((currentSensorState == STATE_GAS_DETECTED) ? "Gas" : "Fumaca");

  String json; serializeJson(doc, json);
  webSocket.sendTXT(json);
  lastHeartbeatTime = millis();
}

void setup() {
  ESP.wdtEnable(8000); 

  pinMode(BUTTON_RESET_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LED_OFF); // LED desligado (HIGH)
  
  pinMode(MQ_DO_PIN, INPUT); // Pino digital do sensor
  // A0 é analógico, não precisa de pinMode

  delay(100); 
  
  loadConfig(); // Carrega o IP e ID Salvos

  String mac = WiFi.macAddress();
  mac.replace(":", "");
  String mac_suffix = mac.substring(mac.length() - 6);
  String apName = "DetectorGasAP_" + mac_suffix;

  WiFiManager wm;
  wm.setAPCallback(wifiManagerCallback);
  
  // Parâmetros do Portal de Configuração
  WiFiManagerParameter custom_device_id("deviceid", "ID do Detector", deviceId, 40);
  WiFiManagerParameter custom_server_ip("serverip", "IP do Servidor", ws_host, 20);
  
  wm.addParameter(&custom_device_id);
  wm.addParameter(&custom_server_ip);
  wm.setConfigPortalTimeout(180);

  if (!wm.autoConnect(apName.c_str())) {
    delay(3000);
    ESP.restart();
  }

  // Salva se os valores do portal mudaram
  if (strcmp(deviceId, custom_device_id.getValue()) != 0 || strcmp(ws_host, custom_server_ip.getValue()) != 0) {
    strcpy(deviceId, custom_device_id.getValue());
    strcpy(ws_host, custom_server_ip.getValue());
    saveConfig();
  }
  
  currentLedState = SERVER_DISCONNECTED;
  
  // Conecta ao servidor WebSocket
  webSocket.begin(ws_host, ws_port, ws_path);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  
  // *** IMPORTANTE: Heartbeat automático DESATIVADO ***
  // webSocket.enableHeartbeat(20000, 5000, 2); 
  // Nós confiamos no "ping por dados" do servidor.
}

void loop() {
  ESP.wdtFeed(); 
  webSocket.loop(); // Essencial para manter a conexão
  
  // Envia o primeiro heartbeat assim que conectar
  if (sendInitialHeartbeat) {
    sendInitialHeartbeat = false;
    sendHeartbeat();
  }
  
  handleLed();
  handleButton();
  handleAlertResend();
  
  // Envia heartbeat periódico
  if (isConnected && millis() - lastHeartbeatTime > heartbeatInterval) {
    sendHeartbeat();
  }
  
  // Lógica principal de detecção
  verificarSensores();
}