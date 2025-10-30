// v21 Modificado - Implementação do Canal de Notificações com Servidor em Nuvem
// - Baseado na v20 estável.
// - Removida a retransmissão automática de mensagens HEARTBEAT.
// - Adicionada a lógica de "Canal de Broadcast": qualquer mensagem
//   do tipo "SYSTEM_BROADCAST" é retransmitida para todos os clientes.

#include <WiFi.h>
#include <WiFiManager.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include "time.h"
#include "SPI.h"
#include "SD.h"
#include <sqlite3.h>
#include "esp_task_wdt.h"
#include <map>
#include <HTTPClient.h>
#include <WiFiClientSecure.h> // Necessário para HTTPS

// --- CONFIGURAÇÕES ---
const int MQ2_PIN = 33;
const int SD_CS_PIN = 5;
const int BACKUP_BUTTON_PIN = 27;
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = -10800; // GMT-3
const int daylightOffset_sec = 0;
const int WDT_TIMEOUT_S = 10;
// URL do servidor Vercel para envio de alertas (SEM a barra final)
const char* vercelServerUrl = "https://vercel-arpa3i.vercel.app/api/alert";

// --- VARIÁVEIS GLOBAIS ---
const char* myApiKey = "f4b3c2d1-a6e5-4f78-9b9c-8e0d3a2b1c0f-arpa3i"; // Sua chave de API
AsyncWebServer server(86);
AsyncWebSocket ws("/ws");
std::map<uint32_t, String> clientDeviceIds;
String ultimoEstadoSensor = "Ambiente Seguro";
unsigned long ultimoPing = 0;

// --- VARIÁVEIS PARA LOG DE ALERTA ASSÍNCRONO ---
volatile bool alertPending = false;
String pendingAlertType;
String pendingAlertMessage;

// --- VARIÁVEIS GLOBAIS ADICIONAIS ---
bool cloudServerAvailable = true;
int failedCloudConnections = 0;
const int maxFailedConnections = 5; // Ajuste o n° de tentativas se desejar

// --- CONFIGURAÇÕES DO BANCO DE DADOS E BACKUP ---
sqlite3 *db;
const char* db_path = "/sd/arpa3i_data.db";
const char* db_backup_path = "/sd/arpa3i_data.db.bak";
unsigned long last_backup_time = 0;
const unsigned long backup_interval = 3600000; // 1 hora

// --- CONTROLE DO BOTÃO DE BACKUP ---
int buttonState = HIGH;
int lastBackupButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const long debounceDelay = 50;

// --- PROTÓTIPOS ---
void setupWebSocket();
void enviarEstadoSensor(String estado);
void verificarSensor();
void enviarPing();
void initDatabase();
void handleUserResetPassword(AsyncWebServerRequest *request);
void logAlert(const char* alertType, const char* message);
void handleAlertLogging();
void handleBackupButton();
String getFormattedTime();
void WiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info);
void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len);
int db_exec(sqlite3 *db, const char *sql);
bool copyFile(const char* srcPath, const char* destPath);
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
void handleAlertsGet(AsyncWebServerRequest *request);
void handleAcknowledgeAlert(AsyncWebServerRequest *request);
void broadcastFallAlert(String local, String dispositivo);
void broadcastPanicAlert(String dispositivo);
bool acknowledgeLatestAlert(String user);
void sendAckToClient(AsyncWebSocketClient *client, const char* alertType);
void enviarAlertaVercel(String tipoAlerta, String local, String dispositivo);
String urlEncode(String str);
bool testCloudConnection();
void resetFailedConnectionCounter();


void wifiManagerCallback(WiFiManager *myWiFiManager) {
  Serial.println("Entrou no modo de configuracao do AP... alimentando o watchdog.");
  esp_task_wdt_reset();
}

void setup() {
    Serial.begin(115200);
    pinMode(MQ2_PIN, INPUT);
    pinMode(BACKUP_BUTTON_PIN, INPUT_PULLUP);

    if (!SD.begin(SD_CS_PIN)) {
        Serial.println("Falha na inicializacao do Cartao SD!");
        while (1);
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
    logAlert("INFO", ("Sistema iniciado. IP: " + WiFi.localIP().toString()).c_str());

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
    server.begin();

    Serial.println("\n--- Comandos de Simulacao Disponiveis ---");
    Serial.println("g: Simular Vazamento de Gas");
    Serial.println("f: Simular Fumaca");
    Serial.println("s: Simular Ambiente Seguro");
    Serial.println("-----------------------------------------");

    esp_task_wdt_config_t wdt_config = { .timeout_ms = (uint32_t)(WDT_TIMEOUT_S * 1000), .trigger_panic = true };
    esp_task_wdt_init(&wdt_config);
    esp_task_wdt_add(NULL);
}

void loop() {
    esp_task_wdt_reset();
    ws.cleanupClients();
    verificarSensor();
    enviarPing();
    handleAlertLogging();
    handleBackup();
    handleBackupButton();

    if (Serial.available() > 0) {
        char input = Serial.read();
        String estadoSimulado = "";
        switch (input) {
            case 'g': estadoSimulado = "Vazamento de Gás"; break;
            case 'f': estadoSimulado = "Fumaça Detectada"; break;
            case 's': estadoSimulado = "Ambiente Seguro"; break;
        }
        if (estadoSimulado != "") {
            String logMsg = estadoSimulado;
            logMsg.toUpperCase();
            Serial.println("\n>>> SIMULANDO: " + logMsg + " <<<");

            ultimoEstadoSensor = estadoSimulado;
            enviarEstadoSensor(ultimoEstadoSensor);
            if (estadoSimulado != "Ambiente Seguro") {
                 if (!alertPending) {
                    String msg = "Alerta simulado via Serial";
                    const char* alertType = (estadoSimulado == "Fumaça Detectada") ? "FUMACA_SIMULADA" : "GAS_SIMULADO";
                    pendingAlertType = alertType;
                    pendingAlertMessage = msg;
                    alertPending = true;
                }
            }
        }
    }
}

void sendAckToClient(AsyncWebSocketClient *client, const char* alertType) {
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
        enviarEstadoSensor(ultimoEstadoSensor);

    } else if (type == WS_EVT_DISCONNECT) {
        String deviceId = clientDeviceIds[client->id()];
        Serial.printf("Dispositivo '%s' desconectado.\n", deviceId.c_str());
        if (deviceId.startsWith("detector")) {
            String json = "{\"type\":\"DEVICE_STATUS\",\"deviceId\":\"" + deviceId + "\",\"status\":\"offline\"}";
            ws.textAll(json);
        }
        clientDeviceIds.erase(client->id());

    } else if (type == WS_EVT_DATA) {
        AwsFrameInfo *info = (AwsFrameInfo*)arg;
        if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
            data[len] = 0;
            StaticJsonDocument<1024> doc;
            if (deserializeJson(doc, (char*)data).code() == DeserializationError::Ok) {

                if(doc.containsKey("deviceId")){
                    String deviceId = doc["deviceId"];
                    if (clientDeviceIds[client->id()] != deviceId) {
                        Serial.printf("Cliente #%u ('%s') identificado como '%s'.\n", client->id(), clientDeviceIds[client->id()].c_str(), deviceId.c_str());
                        clientDeviceIds[client->id()] = deviceId;

                        if (deviceId.startsWith("detector")) {
                            String json = "{\"type\":\"DEVICE_STATUS\",\"deviceId\":\"" + deviceId + "\",\"status\":\"online\"}";
                            ws.textAll(json);
                        }
                    }
                }

                const char* type_msg = doc["type"] | "";
                String deviceId = clientDeviceIds[client->id()];

                if (strcmp(type_msg, "ALERTA") == 0) {
                    const char* sub_type = doc["sub_type"] | "";

                    if (strcmp(sub_type, "PANICO") == 0) {
                        String logMsg = "Botao de panico acionado por: " + deviceId;
                        Serial.printf("--- ALERTA DE PÂNICO recebido de '%s' ---\n", deviceId.c_str());
                        logAlert("PANICO", logMsg.c_str());
                        sendAckToClient(client, "PANICO");
                        broadcastPanicAlert(deviceId);

                    } else if (strcmp(sub_type, "QUEDA") == 0) {
                        JsonObject detalhes = doc["detalhes"];
                        String local = detalhes["local"] | "desconhecido";
                        String logMsg = "Queda detectada por: " + deviceId + " (" + local + ")";
                        Serial.printf("--- ALERTA DE QUEDA recebido de '%s', sensor [%s] ---\n", deviceId.c_str(), local.c_str());
                        logAlert("QUEDA", logMsg.c_str());
                        sendAckToClient(client, "QUEDA");                        
                        broadcastFallAlert(local, deviceId);
                    }
                }
                else if (strcmp(type_msg, "ACK_ALERTA") == 0) {
                    Serial.printf("--- Recebida confirmacao de ciencia de '%s' ---\n", deviceId.c_str());
                    if (!acknowledgeLatestAlert(deviceId)) {
                        String logMsg = "Usuario [" + deviceId + "] confirmou ciencia de um alerta.";
                        logAlert("ALERTA_CIENTE", logMsg.c_str());
                    }
                }
                else if (strcmp(type_msg, "HEARTBEAT") == 0) {
                    String msg;
                    JsonObject hbData = doc["data"];
                    long uptime_ms = hbData["uptime_ms"] | 0;
                    int reconnects = hbData["reconnects"] | 0;

                    if (hbData.containsKey("tensao_mV")) {
                        int tensao_mV = hbData["tensao_mV"] | 0;
                        Serial.printf("--- Heartbeat de '%s': Tensao=%dmV, Uptime=%lums, Reconexoes=%d ---\n",
                                      deviceId.c_str(), tensao_mV, uptime_ms/1000, reconnects);
                        msg = "Status: " + deviceId + " | Tensao: " + String(tensao_mV) + "mV | Uptime: " +
                              String(uptime_ms/1000) + "s | Reconexoes: " + String(reconnects);
                        if (tensao_mV < 3200) {
                            logAlert("BATERIA_FRACA", ("Alerta de bateria fraca para: " + deviceId).c_str());
                        }
                    } else {
                        float temp_cpu_c = hbData["temp_cpu_c"] | 0.0f;
                        long free_heap_b = hbData["free_heap_b"] | 0L;
                        int wifi_rssi_dbm = hbData["wifi_rssi_dbm"] | 0;
                        Serial.printf("--- Heartbeat de '%s': Temp=%.1fC, Heap=%ldB, RSSI=%ddBm, Uptime=%lums, Reconexoes=%d ---\n",
                                      deviceId.c_str(), temp_cpu_c, free_heap_b, wifi_rssi_dbm, uptime_ms/1000, reconnects);
                        msg = "Status: " + deviceId + " | Temp: " + String(temp_cpu_c) + "C | Heap: " +
                              String(free_heap_b) + "B | RSSI: " + String(wifi_rssi_dbm) + "dBm | Uptime: " +
                              String(uptime_ms/1000) + "s | Reconexoes: " + String(reconnects);
                    }

                    if (!alertPending) {
                        pendingAlertType = "HEARTBEAT";
                        pendingAlertMessage = msg;
                        alertPending = true;
                    }
                }
                // << NOVO BLOCO PARA O CANAL DE BROADCAST DO SISTEMA >>
                else if (strcmp(type_msg, "SYSTEM_BROADCAST") == 0) {
                    String jsonBroadcast = (char*)data;
                    ws.textAll(jsonBroadcast);
                    Serial.println(">>> Retransmitindo SYSTEM_BROADCAST: " + jsonBroadcast);
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
    
    // Enviar alerta para o backend na Vercel
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
    
    // Enviar alerta para o backend na Vercel
    enviarAlertaVercel("PANICO", "", dispositivo);
}

bool acknowledgeLatestAlert(String user) {
    sqlite3_stmt *stmt;
    const char *sql = "UPDATE alerts SET acknowledged_by = ?, acknowledged_at = ? WHERE id = (SELECT id FROM alerts WHERE (alert_type LIKE '%FUMACA%' OR alert_type LIKE '%GAS%') AND acknowledged_by IS NULL ORDER BY id DESC LIMIT 1);";
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

void enviarPing() {
    if (millis() - ultimoPing > 10000) {
        ws.textAll("{\"type\":\"ping\"}");
        ultimoPing = millis();
    }
}

void verificarSensor() {
    int sensorValue = analogRead(MQ2_PIN);
    // Valores de threshold para detecção de gás/fumaça
    if (sensorValue > 1000) { // Ajuste este valor conforme a sensibilidade desejada
        String novoEstado = "Alerta: ";
        String tipoAlerta;
        
        // Determinar se é gás ou fumaça com base no valor do sensor
        if (sensorValue > 2000) {
            novoEstado += "Gás Detectado";
            tipoAlerta = "GAS";
        } else {
            novoEstado += "Fumaça Detectada";
            tipoAlerta = "FUMACA";
        }
        
        // Só envia alerta se o estado mudou
        if (novoEstado != ultimoEstadoSensor) {
            ultimoEstadoSensor = novoEstado;
            enviarEstadoSensor(novoEstado);
            
            // Registra o alerta no banco de dados local
            logAlert(tipoAlerta.c_str(), novoEstado.c_str());
            
            // Envia o alerta para o backend na Vercel
            enviarAlertaVercel(tipoAlerta, "", "");
        }
    } else if (ultimoEstadoSensor != "Ambiente Seguro") {
        ultimoEstadoSensor = "Ambiente Seguro";
        enviarEstadoSensor(ultimoEstadoSensor);
    }
}

// Função para enviar alertas para o backend na Vercel (VERSÃO POST COM JSON)
void enviarAlertaVercel(String tipoAlerta, String local, String dispositivo) {
    HTTPClient http;

    // ***** ALTERAÇÃO 1 DE 2: Mude para WiFiClientSecure *****
    // Isso é necessário para conexões seguras (https)
    WiFiClientSecure client; 
    
    bool success = false;
    int attempts = 0;
    const int maxAttempts = 3;
    
    // 1. O servidor espera "type" e "message". Vamos criar a mensagem.
    String mensagem;
    if (tipoAlerta == "QUEDA") {
        mensagem = "Queda detectada em " + local + ". Dispositivo: " + dispositivo;
    } else if (tipoAlerta == "PANICO") {
        mensagem = "Botão de pânico acionado. Dispositivo: " + dispositivo;
    } else { // GAS, FUMACA, etc.
        mensagem = "Alerta de " + tipoAlerta + " detectado no servidor local (MQ2).";
    }

    while (!success && attempts < maxAttempts) { 
        
        StaticJsonDocument<256> doc;
        doc["type"] = tipoAlerta;
        doc["message"] = mensagem;
        String jsonPayload;
        serializeJson(doc, jsonPayload);

        Serial.print("Enviando alerta para Vercel (tentativa " + String(attempts+1) + "): ");
        Serial.println(vercelServerUrl); 
        Serial.print("Payload: ");
        Serial.println(jsonPayload);

        // ***** ALTERAÇÃO 2 DE 2: Adicione esta linha *****
        // Pula a validação do certificado SSL para conexões https
        client.setInsecure(); 

        // 3. Iniciar requisição
        http.begin(client, vercelServerUrl);
        
        // Diz à biblioteca para SEGUIR o redirecionamento 308 automaticamente
        http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
        
        // 4. Adicionar os cabeçalhos (Headers) OBRIGATÓRIOS
        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-API-Key", myApiKey); 
        http.addHeader("User-Agent", "PostmanRuntime/7.26.8");
        http.addHeader("Accept", "*/*");
        
        // 5. Mudar de GET para POST e enviar o payload
        int httpResponseCode = http.POST(jsonPayload);
        
        if (httpResponseCode > 0) { 
            String response = http.getString();
            Serial.print("Resposta do servidor: ");
            Serial.println(httpResponseCode); 
            Serial.println(response);

            // SUCESSO é 200 OK.
            if (httpResponseCode == 200) {
                success = true;
            } else {
                attempts++; // Qualquer outra coisa (308, 400, 500) é uma falha
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


// Função auxiliar para codificar URL
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

// Função para testar a conexão com o servidor em nuvem
bool testCloudConnection() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi desconectado. Não é possível testar conexão com servidor.");
        return false;
    }
    
    // ***** CORREÇÃO AQUI TAMBÉM *****
    WiFiClientSecure client;
    HTTPClient http;
    
    // Envia uma requisição de teste para o servidor
    // A URL de teste deve ser a /api/ (rota GET) e não /api/alert (rota POST)
    String testUrl = String(vercelServerUrl); // Pega a base "https://.../api/alert"
    testUrl.replace("/api/alert", "/api/");   // Substitui para ficar ".../api/"
    
    Serial.print("Testando conexão com servidor (rota GET /api/): ");
    Serial.println(testUrl);
    
    // ***** E ADICIONE ESTA LINHA *****
    client.setInsecure();

    http.begin(client, testUrl);
    http.setTimeout(5000); // Timeout de 5 segundos
    int httpResponseCode = http.GET();
    bool success = (httpResponseCode == 200); // Sucesso aqui é 200 OK
    
    if (success) {
        Serial.print("Conexão com servidor bem-sucedida. Código: ");
        Serial.println(httpResponseCode);
        String response = http.getString(); // Pega a resposta ("Backend... V_LIMPA")
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

// Função para resetar o contador de falhas de conexão
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

bool copyFile(const char* srcPath, const char* destPath) {
    File srcFile = SD.open(srcPath, FILE_READ);
    if (!srcFile) return false;
    if (SD.exists(destPath)) SD.remove(destPath);
    File destFile = SD.open(destPath, FILE_WRITE);
    if (!destFile) { srcFile.close(); return false; }
    uint8_t buf[512];
    size_t bytesRead;
    while ((bytesRead = srcFile.read(buf, sizeof(buf))) > 0) {
        destFile.write(buf, bytesRead);
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
        if (copyFile(db_path, db_backup_path)) { backup_success = true; break; }
        delay(300);
    }
    if (backup_success) Serial.println("Backup do banco de dados concluido com sucesso.");
    else Serial.println("Falha ao criar o backup do banco de dados apos multiplas tentativas.");
    if (sqlite3_open(db_path, &db)) Serial.printf("CRITICO: Nao foi possivel reabrir o banco de dados: %s\n", sqlite3_errmsg(db));
    else Serial.println("Banco de dados reaberto com sucesso.");
    last_backup_time = millis();
}

void handleBackup() {
    if (millis() - last_backup_time > backup_interval) { performBackup(); }
}

void initDatabase() {
    bool create_new_db = false;
    if (sqlite3_open(db_path, &db) != SQLITE_OK) {
        sqlite3_close(db);
        if (SD.exists(db_backup_path) && copyFile(db_backup_path, db_path)) {
            if (sqlite3_open(db_path, &db) != SQLITE_OK) create_new_db = true;
        } else create_new_db = true;
    }
    if (create_new_db) { SD.remove(db_path); sqlite3_open(db_path, &db); }
    db_exec(db, "CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, alert_type TEXT NOT NULL, message TEXT NOT NULL, acknowledged_by TEXT, acknowledged_at TEXT);");
    db_exec(db, "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);");
    if (db_exec(db, "CREATE TABLE IF NOT EXISTS elderly_data (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT, age INTEGER, family_contact_name TEXT, family_contact_phone TEXT, observations TEXT);") == SQLITE_OK) {
        db_exec(db, "INSERT OR IGNORE INTO elderly_data (id) VALUES (1);");
    }
    if (create_new_db) { sqlite3_close(db); copyFile(db_path, db_backup_path); sqlite3_open(db_path, &db); last_backup_time = millis(); }
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
                String jsonResponse = "{\"status\":\"success\",\"user\":{\"id\":" + String(sqlite3_column_int(stmt, 0)) + ",\"name\":\"" + String((const char*)sqlite3_column_text(stmt, 1)) + "\",\"email\":\"" + email + "\"}}";
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
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) { request->send(500, "application/json", "{\"error\":\"DB Error\"}"); return; }
    bool first = true;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        if (!first) jsonResponse += ",";
        first = false;
        jsonResponse += "{\"id\":" + String(sqlite3_column_int(stmt, 0)) + ",\"name\":\"" + String((const char*)sqlite3_column_text(stmt, 1)) + "\",\"email\":\"" + String((const char*)sqlite3_column_text(stmt, 2)) + "\"}";
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
        if(update_pass) sql_str += ", password = ? ";
        sql_str += "WHERE id = ?;";
        sqlite3_prepare_v2(db, sql_str.c_str(), -1, &stmt, NULL);
        sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(stmt, 2, email.c_str(), -1, SQLITE_STATIC);
        if(update_pass) {
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
            auto get_text = [&](int col){ return (const char*)sqlite3_column_text(stmt, col); };
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

void handleAlertsGet(AsyncWebServerRequest *request){
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
        jsonResponse += "\"timestamp\":\"" + String((const char*)sqlite3_column_text(stmt, 1)) + "\",";
        jsonResponse += "\"alert_type\":\"" + String((const char*)sqlite3_column_text(stmt, 2)) + "\",";
        jsonResponse += "\"message\":\"" + String((const char*)sqlite3_column_text(stmt, 3)) + "\",";
        const char* ack_by = (const char*)sqlite3_column_text(stmt, 4);
        jsonResponse += "\"acknowledged_by\":" + (ack_by ? "\"" + String(ack_by) + "\"" : "null") + ",";
        const char* ack_at = (const char*)sqlite3_column_text(stmt, 5);
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


void logAlert(const char* alertType, const char* message) {
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
    if (rc != SQLITE_OK) { Serial.printf("SQL error: %s\n", zErrMsg); sqlite3_free(zErrMsg); }
    return rc;
}

void setupWebSocket() {
    ws.onEvent(onEvent);
    server.addHandler(&ws);
}

void enviarEstadoSensor(String estado) {
    int valor = analogRead(MQ2_PIN);
    StaticJsonDocument<200> doc;
    doc["type"] = "sensor";
    doc["tipo"] = estado;
    doc["valor"] = valor;
    String json;
    serializeJson(doc, json);
    ws.textAll(json);
}

void WiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
    if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
        if (!alertPending) { pendingAlertType = "WIFI"; pendingAlertMessage = "Conexao Wi-Fi perdida."; alertPending = true; }
    }
}

String getFormattedTime() {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) return "NO_TIME_DATA";
    char timeString[50];
    strftime(timeString, sizeof(timeString), "%Y-%m-%d %H:%M:%S", &timeinfo);
    return String(timeString);
}