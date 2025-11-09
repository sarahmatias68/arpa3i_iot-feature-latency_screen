// v14 retirado o envio de ping

#include <WiFi.h>
#include <WiFiManager.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>
#include <Preferences.h>
#include "esp_task_wdt.h"
#include "driver/temperature_sensor.h"
#include "esp_mac.h"

// --- CONFIGURAÇÕES ---
#define BUTTON_PIN 1
<<<<<<< HEAD
char ws_host[20] = "192.168.1.6";
=======
char ws_host[20] = "192.168.1.7";
>>>>>>> parent of ace65bc (updates)
const uint16_t ws_port = 86;
const char* ws_path = "/ws";
const int WDT_TIMEOUT_S = 10;
#define RGB_LED_PIN 48
#define RGB_LED_COUNT 1
#define BRIGHTNESS 10
char deviceId[40] = "detector_indefinido";

// --- DEFINIÇÕES DOS SENSORES ---
#define MMWAVE_1_ID "mmWave Quarto"
#define MMWAVE_2_ID "mmWave Sala"
#define BARREIRA_1_ID "Barreira Corredor"
#define BARREIRA_2_ID "Barreira Quintal"

// --- CONTROLE DE ACK E REENVIO ---
volatile bool quedaAlertAwaitingAck = false;
unsigned long quedaAlertSentTime = 0;
String quedaAlertAckOrigem = "";
const long RESEND_INTERVAL = 10000;

// --- VARIÁVEIS GLOBAIS ---
TaskHandle_t TaskMmWave1;
enum LedState { WIFI_CONNECTING, SERVER_DISCONNECTED, SERVER_CONNECTED, AWAITING_ACK, ALERT_GAS, ALERT_SMOKE };
volatile LedState currentLedState = WIFI_CONNECTING;
unsigned long ledPreviousMillis = 0;
bool ledIsOn = false;
WebSocketsClient webSocket;
Adafruit_NeoPixel pixels(RGB_LED_COUNT, RGB_LED_PIN, NEO_GRB + NEO_KHZ800);
Preferences preferences;
bool isConnected = false;
volatile bool sendInitialHeartbeat = false;
unsigned long ultimoAlertaEnviado = 0;
const long cooldownAlerta = 5000;
unsigned long lastHeartbeatTime = 0;
const long heartbeatInterval = 15000;
temperature_sensor_handle_t temp_sensor_handle = NULL;
unsigned long reconnectCounter = 0;

// --- LÓGICA DE PERSISTÊNCIA ---
volatile bool quedaAlertPending = false;
String quedaAlertPendingOrigem = "";

// --- CONTROLE DO BOTÃO E RESET ---
int buttonState = HIGH;
int lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const long debounceDelay = 50;
unsigned long buttonPressStartTime = 0;
bool longPressActionTaken = false;
const long longPressDuration = 10000;

// --- PROTÓTIPOS ---
void sendHeartbeat();
void triggerFactoryReset();
void saveConfig();
void loadConfig();
void enviarAlertaDeQueda(String origem);
void handleQuedaResend();

void wifiManagerCallback(WiFiManager* myWiFiManager) {
  esp_task_wdt_reset();
}

void sendHelloIdentification() {
  if (!isConnected) return;
  StaticJsonDocument<80> doc;
  doc["deviceId"] = deviceId;
  String json; serializeJson(doc, json);
  webSocket.sendTXT(json);
}

void taskMmWave1(void* pvParameters) {
  for (;;) {
    esp_task_wdt_reset();
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

void triggerFactoryReset() {
  for(int i=0; i<6; i++) {
    pixels.setPixelColor(0, (i % 2 == 0) ? pixels.Color(255, 0, 0) : pixels.Color(0, 0, 0));
    pixels.show();
    delay(250);
  }
  WiFiManager wm_reset;
  wm_reset.resetSettings();
  preferences.begin("detector-prefs", false);
  preferences.clear();
  preferences.end();
  ESP.restart();
}

void saveConfig() {
  preferences.begin("detector-prefs", false);
  preferences.putString("deviceId", deviceId);
  preferences.putString("serverIP", ws_host);
  preferences.end();
}

void loadConfig() {
  preferences.begin("detector-prefs", true);
  preferences.getString("deviceId", deviceId, 40);
  preferences.getString("serverIP", ws_host, 20);
  preferences.end();
}

void enviarAlertaDeQueda(String origem) {
  if (quedaAlertAwaitingAck) {
    Serial.println("Nao e possivel enviar novo alerta. Ja existe um aguardando ACK.");
    return;
  }
  if (!isConnected) {
    quedaAlertPending = true;
    quedaAlertPendingOrigem = origem;
    Serial.println("ALERTA DE QUEDA PENDENTE: Sem conexao com o servidor.");
    return;
  }
  if (millis() - ultimoAlertaEnviado < cooldownAlerta) {
    Serial.println("Cooldown de alerta ativo. Nao enviando.");
    return;
  }

  StaticJsonDocument<200> doc;
  doc["type"] = "ALERTA";
  doc["sub_type"] = "QUEDA";
  doc["deviceId"] = deviceId;
  JsonObject detalhes = doc.createNestedObject("detalhes");
  detalhes["local"] = origem;
  String json;
  serializeJson(doc, json);
  
  webSocket.sendTXT(json);
  Serial.println("Enviando alerta de queda. Aguardando ACK: " + json);
  
  ultimoAlertaEnviado = millis();
  quedaAlertPending = false;
  quedaAlertPendingOrigem = "";

  quedaAlertAwaitingAck = true;
  quedaAlertSentTime = millis();
  quedaAlertAckOrigem = origem;
  currentLedState = AWAITING_ACK;
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WSc] Desconectado!");
      isConnected = false;
      currentLedState = SERVER_DISCONNECTED;
      ledIsOn = false;
      reconnectCounter++;
      break;
    case WStype_CONNECTED:
      Serial.printf("[WSc] Conectado ao servidor: %s\n", payload);
      isConnected = true;
      currentLedState = SERVER_CONNECTED;
      ledIsOn = false;
      sendInitialHeartbeat = true;
      // Identifica-se ao servidor com o deviceId
      sendHelloIdentification();
      if (quedaAlertPending) {
        Serial.println("Conexao reestabelecida. Enviando alerta de queda pendente...");
        enviarAlertaDeQueda(quedaAlertPendingOrigem);
      }
      break;
    case WStype_TEXT:
      {
        // Aumentado para 300 para acomodar mensagens de broadcast
        StaticJsonDocument<300> doc;
        if (deserializeJson(doc, payload).code() == DeserializationError::Ok) {
          const char* msg_type = doc["type"] | "";
          
          if (strcmp(msg_type, "ACK") == 0) {
            const char* acked_alert = doc["acked_alert"] | "";
            if (strcmp(acked_alert, "QUEDA") == 0) {
              Serial.println("ACK para o alerta de queda recebido do servidor!");
              quedaAlertAwaitingAck = false;
              if (currentLedState == AWAITING_ACK) {
                  currentLedState = SERVER_CONNECTED;
              }
            }
          } 
          else if (strcmp(msg_type, "sensor") == 0) {
              const char* status = doc["tipo"] | "";
              if (strcmp(status, "Vazamento de Gás") == 0) {
                  Serial.println("ALERTA SECUNDARIO: Gas detectado!");
                  currentLedState = ALERT_GAS;
                  ledIsOn = false;
              } else if (strcmp(status, "Fumaça Detectada") == 0) {
                  Serial.println("ALERTA SECUNDARIO: Fumaca detectada!");
                  currentLedState = ALERT_SMOKE;
                  ledIsOn = false;
              } else if (strcmp(status, "Ambiente Seguro") == 0) {
                  Serial.println("ALERTA SECUNDARIO: Ambiente seguro.");
                  if (!quedaAlertAwaitingAck) {
                      currentLedState = SERVER_CONNECTED;
                  }
                  ledIsOn = false;
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
            sendHeartbeat();
          }
        }
        break;
      }
    default: break;
  }
}

void handleQuedaResend() {
  if (quedaAlertAwaitingAck && (millis() - quedaAlertSentTime > RESEND_INTERVAL)) {
    Serial.println("Nenhum ACK recebido. Reenviando alerta de queda...");
    StaticJsonDocument<200> doc;
    doc["type"] = "ALERTA";
    doc["sub_type"] = "QUEDA";
    doc["deviceId"] = deviceId;
    JsonObject detalhes = doc.createNestedObject("detalhes");
    detalhes["local"] = quedaAlertAckOrigem;
    String json;
    serializeJson(doc, json);
    webSocket.sendTXT(json);
    quedaAlertSentTime = millis();
  }
}

void handleLed() {
  unsigned long currentMillis = millis();
  switch (currentLedState) {
    case WIFI_CONNECTING:
      if (currentMillis - ledPreviousMillis >= 500) {
        ledPreviousMillis = currentMillis;
        pixels.setPixelColor(0, ledIsOn ? pixels.Color(0,0,0) : pixels.Color(0,0,255)); // Azul piscante
        pixels.show();
        ledIsOn = !ledIsOn;
      }
      break;
    case SERVER_DISCONNECTED:
      if (currentMillis - ledPreviousMillis >= 250) {
        ledPreviousMillis = currentMillis;
        pixels.setPixelColor(0, ledIsOn ? pixels.Color(0,0,0) : pixels.Color(255,0,0)); // Vermelho piscante rápido
        pixels.show();
        ledIsOn = !ledIsOn;
      }
      break;
    case AWAITING_ACK:
      if (currentMillis - ledPreviousMillis >= 250) {
        ledPreviousMillis = currentMillis;
        pixels.setPixelColor(0, ledIsOn ? pixels.Color(0,0,0) : pixels.Color(255,165,0)); // Laranja piscante
        pixels.show();
        ledIsOn = !ledIsOn;
      }
      break;
    case SERVER_CONNECTED:
      if (!ledIsOn) {
        pixels.setPixelColor(0, pixels.Color(0, 255, 0)); // Verde constante
        pixels.show();
        ledIsOn = true;
      }
      break;
    case ALERT_GAS:
      if (!ledIsOn) {
        pixels.setPixelColor(0, pixels.Color(255, 255, 0)); // Amarelo constante
        pixels.show();
        ledIsOn = true;
      }
      break;
    case ALERT_SMOKE:
      if (!ledIsOn) {
        pixels.setPixelColor(0, pixels.Color(255, 0, 0)); // Vermelho constante
        pixels.show();
        ledIsOn = true;
      }
      break;
  }
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
      }
    }
  }
  if (buttonState == LOW && !longPressActionTaken && (millis() - buttonPressStartTime > longPressDuration)) {
    longPressActionTaken = true; 
    triggerFactoryReset();
  }
  lastButtonState = reading;
}

void sendHeartbeat() {
  if (!isConnected) return;
  StaticJsonDocument<256> doc;
  doc["type"] = "DEVICE_STATUS";
  doc["deviceId"] = deviceId;
  doc["status"] = "online";
  // métricas disponíveis no detector
  if (temp_sensor_handle != NULL) {
    float temp_c = 0;
    temperature_sensor_get_celsius(temp_sensor_handle, &temp_c);
    doc["tempCpuC"] = (float)(round(temp_c * 10) / 10.0);
  }
  doc["heapB"] = (long)ESP.getFreeHeap();
  doc["rssiDbm"] = (int)WiFi.RSSI();
  doc["uptimeSec"] = (long)(millis() / 1000);
  doc["reconnects"] = (int)reconnectCounter;

  String json; serializeJson(doc, json);
  webSocket.sendTXT(json);
  lastHeartbeatTime = millis();
}

void handleHeartbeat() {
  if (isConnected && (millis() - lastHeartbeatTime > heartbeatInterval)) {
    sendHeartbeat();
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  temperature_sensor_config_t temp_sensor_config = TEMPERATURE_SENSOR_CONFIG_DEFAULT(10, 80);
  if (temperature_sensor_install(&temp_sensor_config, &temp_sensor_handle) == ESP_OK) {
    temperature_sensor_enable(temp_sensor_handle);
  }
  pixels.begin();
  pixels.setBrightness(BRIGHTNESS);
  pixels.clear();
  pixels.show();

  if (digitalRead(BUTTON_PIN) == LOW) {
    unsigned long pressStartTime = millis();
    bool resetCancelled = false;
    while (millis() - pressStartTime < 5000) {
      esp_task_wdt_reset();
      pixels.setPixelColor(0, (millis() / 100 % 2 == 0) ? pixels.Color(255, 0, 0) : pixels.Color(0, 0, 0));
      pixels.show();
      if (digitalRead(BUTTON_PIN) == HIGH) {
        resetCancelled = true;
        break;
      }
    }
    pixels.clear();
    pixels.show();
    if (!resetCancelled && digitalRead(BUTTON_PIN) == LOW) {
      triggerFactoryReset();
    }
  }

  loadConfig();
  uint8_t mac_addr[6];
  char mac_chars[7];
  esp_read_mac(mac_addr, ESP_MAC_WIFI_STA);
  sprintf(mac_chars, "%02X%02X%02X", mac_addr[3], mac_addr[4], mac_addr[5]);
  String apName = "DetectorDeQuedaAP_" + String(mac_chars);

  WiFiManager wm;
  wm.setAPCallback(wifiManagerCallback);
  WiFiManagerParameter custom_device_id("deviceid", "ID do Detector", deviceId, 40);
  WiFiManagerParameter custom_server_ip("serverip", "IP do Servidor", ws_host, 20);
  wm.addParameter(&custom_device_id);
  wm.addParameter(&custom_server_ip);
  wm.setConfigPortalTimeout(180);

  if (!wm.autoConnect(apName.c_str())) {
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

  esp_task_wdt_config_t wdt_config = {
    .timeout_ms = (uint32_t)(WDT_TIMEOUT_S * 1000),
    .idle_core_mask = (1 << 0) | (1 << 1),
    .trigger_panic = true,
  };
  esp_task_wdt_init(&wdt_config);
  esp_task_wdt_add(NULL);

  xTaskCreatePinnedToCore(taskMmWave1, "TaskMmWave1", 4096, NULL, 1, &TaskMmWave1, 0);
  vTaskSuspend(TaskMmWave1);
  esp_task_wdt_add(TaskMmWave1);
  vTaskResume(TaskMmWave1);
}

void loop() {
  esp_task_wdt_reset();
  webSocket.loop();

  if (sendInitialHeartbeat) {
    sendInitialHeartbeat = false;
    sendHeartbeat();
  }
  
  handleLed();
  handleButton();
  handleHeartbeat();
  handleQuedaResend();

  if (Serial.available() > 0) {
    char input = Serial.read();
    switch (input) {
      case '1':
        Serial.println("Simulando queda: " MMWAVE_1_ID);
        enviarAlertaDeQueda(MMWAVE_1_ID);
        break;
      case '2':
        Serial.println("Simulando queda: " MMWAVE_2_ID);
        enviarAlertaDeQueda(MMWAVE_2_ID);
        break;
      case '3':
        Serial.println("Simulando queda: " BARREIRA_1_ID);
        enviarAlertaDeQueda(BARREIRA_1_ID);
        break;
      case '4':
        Serial.println("Simulando queda: " BARREIRA_2_ID);
        enviarAlertaDeQueda(BARREIRA_2_ID);
        break;
    }
  }
}