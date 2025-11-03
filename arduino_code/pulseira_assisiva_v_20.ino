// v18 - Resposta ao App Broadcast
// - Baseado na v17 estável.
// - Modificada a função webSocketEvent para escutar por mensagens
//   do tipo "SYSTEM_BROADCAST" com o "broadcast_type" = "REQUEST_DEVICE_STATUS".
// - Ao receber essa solicitação (enviada pelo app ao iniciar),
//   o dispositivo responde imediatamente com seu sendHeartbeat().
//   Isso corrige o delay de status no app.

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <WiFiManager.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

ADC_MODE(ADC_VCC);

// --- CONFIGURAÇÕES DE REDE ---
char ws_host[20] = "192.168.1.7";
const uint16_t ws_port = 86;
const char* ws_path = "/ws";

// --- CONFIGURAÇÕES DOS PINOS ---
const int BUTTON_PIN = 0;
const int VIBRATION_PIN = 3;
const int LED_PIN = 2;

// --- ID DO DISPOSITIVO ---
char deviceId[40] = "pulseira_indefinida";

// --- CONTROLE DO HEARTBEAT ---
unsigned long lastHeartbeatTime = 0;
const long heartbeatInterval = 15000; // 15s para presença estável sem enableHeartbeat
unsigned long reconnectCounter = 0;

// --- CONTROLE DE ACK E REENVIO ---
volatile bool panicAlertAwaitingAck = false;
unsigned long panicAlertSentTime = 0;
const long RESEND_INTERVAL = 10000;

// --- VARIÁVEIS GLOBAIS ---
WebSocketsClient webSocket;
bool isConnected = false;
volatile bool sendInitialHeartbeat = false;
volatile bool panicAlertPending = false;
enum DeviceState { STATE_NORMAL, STATE_ALERT_GAS_SMOKE, STATE_ALERT_FALL };
DeviceState currentState = STATE_NORMAL;
bool isMotorOn = false;
unsigned long lastVibrationToggleTime = 0;
const long gasSmokeVibrationInterval = 1000;
const long fallVibrationOnDuration = 100;
const long fallVibrationOffDuration = 200;

// --- CONTROLE DO BOTÃO E RESET ---
int buttonState = HIGH;
int lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const long debounceDelay = 50;
unsigned long buttonPressStartTime = 0;
bool longPressActionTaken = false;
const long longPressDuration = 10000;

// --- ESTADOS DO LED DE STATUS ---
enum LedState { WIFI_CONNECTING, SERVER_DISCONNECTED, SERVER_CONNECTED, AWAITING_ACK };
volatile LedState currentLedState = WIFI_CONNECTING;
unsigned long ledPreviousMillis = 0;
bool ledIsOn = false;

// --- PROTÓTIPOS ---
void sendHeartbeat();
void sendHelloIdentification();
void saveConfig();
void loadConfig();
void sendPanicAlert();
void handlePanicResend();
void sendGasSmokeAwarenessConfirmation();
void sendFallAwarenessConfirmation();

void triggerFactoryReset() {
  for(int i=0; i<6; i++) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    delay(250);
  }
  WiFiManager wm_reset;
  wm_reset.resetSettings();
  EEPROM.begin(128);
  for (int i = 0; i < 128; i++) EEPROM.write(i, 0);
  EEPROM.commit();
  EEPROM.end();
  ESP.restart();
}

void saveConfig() {
  EEPROM.begin(128);
  for (int i = 0; i < 40; ++i) EEPROM.write(i, deviceId[i]);
  for (int i = 0; i < 20; ++i) EEPROM.write(i + 40, ws_host[i]);
  EEPROM.commit();
  EEPROM.end();
}

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

void sendPanicAlert() {
  if (!isConnected) {
    panicAlertPending = true;
    return;
  }
  StaticJsonDocument<150> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = "PANICO";
  doc["deviceId"] = deviceId;
  String json;
  serializeJson(doc, json);
  webSocket.sendTXT(json);
  panicAlertPending = false; 
  panicAlertAwaitingAck = true;
  panicAlertSentTime = millis();
  currentLedState = AWAITING_ACK;
  Serial.println("Alerta de panico enviado. Aguardando ACK do servidor...");
}

void sendGasSmokeAwarenessConfirmation() {
  if (!isConnected) return;
  StaticJsonDocument<256> doc;
  doc["type"] = "SYSTEM_BROADCAST";
  doc["deviceId"] = deviceId;
  
  JsonObject data = doc.createNestedObject("data");
  data["broadcast_type"] = "CIENCIA_ALERTA"; 
  data["alert_source"] = "GAS_SMOKE"; 
  data["message"] = "Usuário confirmou ciência do alerta de gás/fumaça.";

  String json;
  serializeJson(doc, json);
  webSocket.sendTXT(json);
  Serial.println("Enviando broadcast de ciencia (GAS/SMOKE)...");
}

void sendFallAwarenessConfirmation() {
  if (!isConnected) return;
  StaticJsonDocument<256> doc;
  doc["type"] = "SYSTEM_BROADCAST";
  doc["deviceId"] = deviceId;

  JsonObject data = doc.createNestedObject("data");
  data["broadcast_type"] = "CIENCIA_ALERTA";
  data["alert_source"] = "QUEDA";
  data["message"] = "Usuário confirmou ciência do alerta de queda.";

  String json;
  serializeJson(doc, json);
  webSocket.sendTXT(json);
  Serial.println("Enviando broadcast de ciencia (QUEDA)...");
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      isConnected = false;
      currentLedState = SERVER_DISCONNECTED;
      reconnectCounter++;
      break;
    case WStype_CONNECTED:
      isConnected = true;
      currentLedState = SERVER_CONNECTED;
      // Identifica-se imediatamente para o servidor marcar ONLINE por deviceId
      sendHelloIdentification();
      sendInitialHeartbeat = true;
      if (panicAlertPending) {
        sendPanicAlert();
      }
      break;
    case WStype_TEXT:
      {
        // Aumentar o buffer para acomodar mensagens maiores (como broadcast de status)
        StaticJsonDocument<300> doc; 
        if (deserializeJson(doc, payload).code() == DeserializationError::Ok) {
          const char* msg_type = doc["type"] | "";
          
          if (strcmp(msg_type, "ACK") == 0) {
            const char* acked_alert = doc["acked_alert"] | "";
            if (strcmp(acked_alert, "PANICO") == 0) {
              Serial.println("ACK para o alerta de panico recebido do servidor!");
              panicAlertAwaitingAck = false;
              currentLedState = SERVER_CONNECTED;
            }
          }
          else if (strcmp(msg_type, "ALERTA") == 0) {
            const char* sub_type = doc["sub_type"] | "";
            if (strcmp(sub_type, "QUEDA") == 0) {
              Serial.println("Alerta de QUEDA recebido do servidor!");
              currentState = STATE_ALERT_FALL;
            }
          }
          else if (strcmp(msg_type, "sensor") == 0) {
            const char* status = doc["tipo"];
            if (strcmp(status, "Fumaça Detectada") == 0 || strcmp(status, "Vazamento de Gás") == 0) {
              currentState = STATE_ALERT_GAS_SMOKE;
            }
          }
          // Responde a ping do servidor reforçando presença
          else if (strcmp(msg_type, "ping") == 0) {
            sendHeartbeat();
          }
          // --- INÍCIO DA MODIFICAÇÃO (v18) ---
          // Adiciona a lógica para responder ao App
          else if (strcmp(msg_type, "SYSTEM_BROADCAST") == 0) {
            JsonObject data = doc["data"];
            const char* broadcast_type = data["broadcast_type"] | "";
            
            // Verifica se é a solicitação de status vinda do app
            if (strcmp(broadcast_type, "REQUEST_DEVICE_STATUS") == 0) {
              Serial.println("Solicitacao de status recebida. Respondendo com heartbeat...");
              // Responde imediatamente com o status
              sendHeartbeat(); 
            }
          }
          // --- FIM DA MODIFICAÇÃO (v18) ---
        }
        break;
      }
    default:
      break;
  }
}

void handlePanicResend() {
  if (panicAlertAwaitingAck && (millis() - panicAlertSentTime > RESEND_INTERVAL)) {
    Serial.println("Nenhum ACK recebido. Reenviando alerta de panico...");
    sendPanicAlert();
  }
}

void handleVibration() {
  switch(currentState) {
    case STATE_NORMAL:
      return;
    
    case STATE_ALERT_GAS_SMOKE:
      if (millis() - lastVibrationToggleTime >= gasSmokeVibrationInterval) {
        lastVibrationToggleTime = millis();
        isMotorOn = !isMotorOn;
        digitalWrite(VIBRATION_PIN, isMotorOn ? HIGH : LOW);
      }
      break;

    case STATE_ALERT_FALL:
      unsigned long cycleTime = fallVibrationOnDuration + fallVibrationOffDuration;
      if (millis() - lastVibrationToggleTime >= cycleTime) {
          lastVibrationToggleTime = millis();
      }
      isMotorOn = (millis() - lastVibrationToggleTime) < fallVibrationOnDuration;
      digitalWrite(VIBRATION_PIN, isMotorOn ? HIGH : LOW);
      break;
  }
}

void handleButton() {
  int reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading != buttonState) {
      buttonState = reading;
      if (buttonState == LOW) {
        buttonPressStartTime = millis();
        longPressActionTaken = false;
      } else {
        if (!longPressActionTaken) {
          unsigned long pressDuration = millis() - buttonPressStartTime;
          if (pressDuration < longPressDuration) {
            
            if (currentState == STATE_NORMAL && !panicAlertAwaitingAck) {
              sendPanicAlert();
            } else if (currentState == STATE_ALERT_GAS_SMOKE) {
              currentState = STATE_NORMAL;
              digitalWrite(VIBRATION_PIN, LOW); isMotorOn = false;
              sendGasSmokeAwarenessConfirmation();
            } else if (currentState == STATE_ALERT_FALL) {
              currentState = STATE_NORMAL;
              digitalWrite(VIBRATION_PIN, LOW); isMotorOn = false;
              sendFallAwarenessConfirmation();
            }

          }
        }
      }
    }
  }

  if (buttonState == LOW && !longPressActionTaken && (millis() - buttonPressStartTime > longPressDuration)) {
    longPressActionTaken = true; 
    triggerFactoryReset();
  }
  lastButtonState = reading;
}

void handleLed() {
    unsigned long currentMillis = millis();
    unsigned long interval = 500;
    switch (currentLedState) {
        case WIFI_CONNECTING: interval = 500; break;
        case SERVER_DISCONNECTED: interval = 150; break;
        case AWAITING_ACK: interval = 250; break;
        case SERVER_CONNECTED:
            if (!ledIsOn) {
                digitalWrite(LED_PIN, LOW);
                ledIsOn = true;
            }
            return; 
    }
    if (currentMillis - ledPreviousMillis >= interval) {
        ledPreviousMillis = currentMillis;
        digitalWrite(LED_PIN, !digitalRead(LED_PIN));
        ledIsOn = (digitalRead(LED_PIN) == LOW);
    }
}

void sendHeartbeat() {
  if (!isConnected) return;
  StaticJsonDocument<192> doc;
  doc["type"] = "DEVICE_STATUS";
  doc["deviceId"] = deviceId;
  doc["status"] = "online";
  doc["batteryMv"] = (int)ESP.getVcc();
  doc["uptimeSec"] = (long)(millis() / 1000);
  doc["reconnects"] = (int)reconnectCounter;
  // Métricas adicionais para exibir no app
  doc["rssiDbm"] = (int)WiFi.RSSI();
  doc["heapB"] = (long)ESP.getFreeHeap();

  String json; serializeJson(doc, json);
  webSocket.sendTXT(json);
  lastHeartbeatTime = millis();
  Serial.println("Enviando broadcast de status (heartbeat)...");
}

void sendHelloIdentification() {
  if (!isConnected) return;
  StaticJsonDocument<80> doc;
  doc["deviceId"] = deviceId;
  String json; serializeJson(doc, json);
  webSocket.sendTXT(json);
}

void handleHeartbeat() {
  if (isConnected && (millis() - lastHeartbeatTime > heartbeatInterval)) {
    sendHeartbeat();
  }
}

void setup() {
  ESP.wdtEnable(8000); 

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(VIBRATION_PIN, OUTPUT);
  digitalWrite(VIBRATION_PIN, LOW);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);
  delay(100); 

  if (digitalRead(BUTTON_PIN) == LOW) {
    unsigned long pressStartTime = millis();
    bool resetCancelled = false;
    while (millis() - pressStartTime < 5000) {
      ESP.wdtFeed();
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      delay(100);
      if (digitalRead(BUTTON_PIN) == HIGH) {
        resetCancelled = true;
        break;
      }
    }
    digitalWrite(LED_PIN, HIGH);
    if (!resetCancelled && digitalRead(BUTTON_PIN) == LOW) {
      triggerFactoryReset();
    }
  }

  loadConfig();

  String mac = WiFi.macAddress();
  mac.replace(":", "");
  String mac_suffix = mac.substring(mac.length() - 6);
  String apName = "PulseiraAssistivaAP_" + mac_suffix;

  WiFiManager wm;
  wm.setAPCallback(wifiManagerCallback);
  
  WiFiManagerParameter custom_device_id("deviceid", "ID da Pulseira", deviceId, 40);
  WiFiManagerParameter custom_server_ip("serverip", "IP do Servidor", ws_host, 20);
  
  wm.addParameter(&custom_device_id);
  wm.addParameter(&custom_server_ip);
  wm.setConfigPortalTimeout(180);

  if (!wm.autoConnect(apName.c_str())) {
    delay(3000);
    ESP.restart();
  }

  if (strcmp(deviceId, custom_device_id.getValue()) != 0 || strcmp(ws_host, custom_server_ip.getValue()) != 0) {
    strcpy(deviceId, custom_device_id.getValue());
    strcpy(ws_host, custom_server_ip.getValue());
    saveConfig();
  }
  
  currentLedState = SERVER_DISCONNECTED;
  webSocket.begin(ws_host, ws_port, ws_path);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  //webSocket.enableHeartbeat(20000, 5000, 2);
}

void loop() {
  ESP.wdtFeed(); 
  webSocket.loop();
  
  if (sendInitialHeartbeat) {
    sendInitialHeartbeat = false;
    sendHeartbeat();
  }
  
  handleLed();
  handleVibration();
  handleButton();
  handleHeartbeat();
  handlePanicResend();
}