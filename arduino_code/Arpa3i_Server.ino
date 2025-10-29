#include <WiFi.h>
#include <WiFiManager.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include "time.h"
#include "SPI.h"
#include "SD.h"
#include <sqlite3.h>

// --- CONFIGURAÇÕES ---
// SSID e Senha são gerenciados pelo WiFiManager
const int MQ2_PIN = 33;
const int SD_CS_PIN = 5;
const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = -10800; // GMT-3
const int   daylightOffset_sec = 0;

// --- VARIÁVEIS GLOBAIS ---
AsyncWebServer server(86);
AsyncWebSocket ws("/ws");
String ultimoEstadoSensor = "Ambiente Seguro";
String ultimoEstadoBotao = "Desconectado";
unsigned long ultimoPing = 0;

// --- CONFIGURAÇÕES DO BANCO DE DADOS E BACKUP ---
sqlite3 *db;
const char* db_path = "/sd/arpa3i_data.db";
const char* db_backup_path = "/sd/arpa3i_data.db.bak";
unsigned long last_backup_time = 0;
const unsigned long backup_interval = 3600000; // 1 hora

// --- PROTÓTIPOS ---
void setupWebSocket();
void enviarEstadoSensor(String estado);
void enviarEstadoBotao(String estado);
void verificarSensor();
void enviarPing();
void initDatabase();
void handleUserResetPassword(AsyncWebServerRequest *request);
void logAlert(const char* alertType, const char* message);
String getFormattedTime();
void WiFiEvent(WiFiEvent_t event);
void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len);
int db_exec(sqlite3 *db, const char *sql);
bool copyFile(const char* srcPath, const char* destPath);
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

// =================================================================
//  FUNÇÃO SETUP
// =================================================================
void setup() {
    Serial.begin(115200);
    pinMode(MQ2_PIN, INPUT);

    if (!SD.begin(SD_CS_PIN)) {
        Serial.println("Falha na inicializacao do Cartao SD!");
        while (1);
    }
    Serial.println("Cartao SD inicializado.");

    initDatabase();

    WiFi.onEvent(WiFiEvent);

    // --- GERENCIADOR DE WIFI ---
    WiFiManager wm;
    wm.setConfigPortalTimeout(180);

    if (!wm.autoConnect("ServidorArpa3iAP")) {
        Serial.println("Falha ao conectar e o tempo de configuração expirou. Reiniciando...");
        delay(3000);
        ESP.restart();
    }

    Serial.println("\nConectado! IP: " + WiFi.localIP().toString());

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
    // Endpoints de dispositivos (registro de tipos)
    server.on("/devices", HTTP_GET, [](AsyncWebServerRequest *request){
        String json = "[";
        sqlite3_stmt *stmt;
        const char *sql = "SELECT device_id, device_type FROM devices ORDER BY device_id;";
        if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) {
            request->send(500, "application/json", "{\"error\":\"DB Error\"}");
            return;
        }
        bool first = true;
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            if (!first) json += ",";
            first = false;
            String id = String((const char*)sqlite3_column_text(stmt, 0));
            String type = String((const char*)sqlite3_column_text(stmt, 1));
            json += "{\"deviceId\":\"" + id + "\",\"deviceType\":\"" + type + "\"}";
        }
        json += "]";
        sqlite3_finalize(stmt);
        request->send(200, "application/json", json);
    });
    // Upsert de tipo do dispositivo
    server.on("/devices/set", HTTP_POST, [](AsyncWebServerRequest *request){
        if (!(request->hasParam("deviceId", true) && request->hasParam("type", true))) {
            request->send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing params\"}");
            return;
        }
        String deviceId = request->getParam("deviceId", true)->value();
        String type = request->getParam("type", true)->value();
        const char *sql = "INSERT INTO devices (device_id, device_type) VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET device_type=excluded.device_type;";
        sqlite3_stmt *stmt;
        if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
            sqlite3_bind_text(stmt, 1, deviceId.c_str(), -1, SQLITE_STATIC);
            sqlite3_bind_text(stmt, 2, type.c_str(), -1, SQLITE_STATIC);
            if (sqlite3_step(stmt) == SQLITE_DONE) request->send(200, "application/json", "{\"status\":\"success\"}");
            else request->send(500, "application/json", "{\"status\":\"error\"}");
        } else {
            request->send(500, "application/json", "{\"status\":\"error\",\"message\":\"SQL prepare failed\"}");
        }
        sqlite3_finalize(stmt);
    });
    // Remover tipo do dispositivo
    server.on("/devices/delete", HTTP_POST, [](AsyncWebServerRequest *request){
        if (!request->hasParam("deviceId", true)) {
            request->send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing deviceId\"}");
            return;
        }
        String deviceId = request->getParam("deviceId", true)->value();
        const char *sql = "DELETE FROM devices WHERE device_id = ?;";
        sqlite3_stmt *stmt;
        if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
            sqlite3_bind_text(stmt, 1, deviceId.c_str(), -1, SQLITE_STATIC);
            if (sqlite3_step(stmt) == SQLITE_DONE) request->send(200, "application/json", "{\"status\":\"success\"}");
            else request->send(500, "application/json", "{\"status\":\"error\"}");
        } else {
            request->send(500, "application/json", "{\"status\":\"error\",\"message\":\"SQL prepare failed\"}");
        }
        sqlite3_finalize(stmt);
    });

    server.begin();
}

// =================================================================
//  FUNÇÃO LOOP - OTIMIZADA
// =================================================================
void loop() {
    ws.cleanupClients();
    verificarSensor();
    enviarPing();
}

// =================================================================
//  FUNÇÕES DO SISTEMA
// =================================================================
void enviarPing() {
    if (millis() - ultimoPing > 10000) {
        ws.textAll("{\"type\":\"ping\"}");
        ultimoPing = millis();
    }
}

bool copyFile(const char* srcPath, const char* destPath) {
    File srcFile = SD.open(srcPath, FILE_READ);
    if (!srcFile) {
        Serial.printf("Falha ao abrir arquivo de origem: %s\n", srcPath);
        return false;
    }

    if (SD.exists(destPath)) {
        SD.remove(destPath);
    }

    File destFile = SD.open(destPath, FILE_WRITE);
    if (!destFile) {
        Serial.printf("Falha ao criar arquivo de destino: %s\n", destPath);
        srcFile.close();
        return false;
    }

    uint8_t buf[512];
    size_t bytesRead;
    while ((bytesRead = srcFile.read(buf, sizeof(buf))) > 0) {
        destFile.write(buf, bytesRead);
    }

    srcFile.close();
    destFile.close();
    Serial.printf("Copiado com sucesso: %s -> %s\n", srcPath, destPath);
    return true;
}

void handleBackup() {
    if (millis() - last_backup_time > backup_interval) {
        Serial.println("Iniciando rotina de backup do banco de dados...");
        sqlite3_close(db);

        if (copyFile(db_path, db_backup_path)) {
            Serial.println("Backup do banco de dados concluido com sucesso.");
        } else {
            Serial.println("Falha ao criar o backup do banco de dados.");
        }

        if (sqlite3_open(db_path, &db)) {
            Serial.printf("CRITICO: Nao foi possivel reabrir o banco de dados apos o backup: %s\n", sqlite3_errmsg(db));
        } else {
            Serial.println("Banco de dados reaberto com sucesso.");
        }

        last_backup_time = millis();
    }
}

void initDatabase() {
    bool create_new_db = false;
    int rc = sqlite3_open(db_path, &db);

    if (rc != SQLITE_OK) {
        Serial.printf("Nao foi possivel abrir o banco de dados: %s (codigo: %d)\n", sqlite3_errmsg(db), rc);
        sqlite3_close(db);

        Serial.println("Tentando restaurar a partir do backup...");
        if (SD.exists(db_backup_path)) {
            if (copyFile(db_backup_path, db_path)) {
                Serial.println("Backup restaurado com sucesso. Tentando abrir novamente...");
                rc = sqlite3_open(db_path, &db);
                if (rc != SQLITE_OK) {
                    Serial.printf("Falha ao abrir o banco de dados restaurado: %s. O backup pode estar corrompido.\n", sqlite3_errmsg(db));
                    create_new_db = true;
                }
            } else {
                Serial.println("Falha ao copiar o arquivo de backup. Criando um novo banco de dados.");
                create_new_db = true;
            }
        } else {
            Serial.println("Nenhum arquivo de backup encontrado. Criando um novo banco de dados.");
            create_new_db = true;
        }
    }

    if (create_new_db) {
        SD.remove(db_path);
        sqlite3_open(db_path, &db);
    }

    Serial.println("Verificando e criando tabelas...");
    db_exec(db, "CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, alert_type TEXT NOT NULL, message TEXT NOT NULL, acknowledged_by TEXT, acknowledged_at TEXT);");
    db_exec(db, "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);");
    // Registro de dispositivos e seus tipos definidos pelo app
    db_exec(db, "CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, device_type TEXT NOT NULL);");
    if (db_exec(db, "CREATE TABLE IF NOT EXISTS elderly_data (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT, age INTEGER, family_contact_name TEXT, family_contact_phone TEXT, observations TEXT);") == SQLITE_OK) {
        db_exec(db, "INSERT OR IGNORE INTO elderly_data (id) VALUES (1);");
    }

    if (create_new_db) {
        Serial.println("Criando backup inicial para o novo banco de dados...");
        sqlite3_close(db);
        if (copyFile(db_path, db_backup_path)) {
            Serial.println("Backup inicial criado com sucesso.");
        } else {
            Serial.println("Falha ao criar backup inicial.");
        }
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

            if (sqlite3_step(stmt) == SQLITE_DONE) {
                if (sqlite3_changes(db) > 0) {
                    request->send(200, "application/json", "{\"status\":\"success\"}");
                } else {
                    request->send(404, "application/json", "{\"status\":\"error\", \"message\":\"E-mail nao encontrado.\"}");
                }
            } else {
                request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Falha ao executar a atualizacao.\"}");
            }
        } else {
            request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Erro no servidor ao preparar a query.\"}");
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

        if (sqlite3_step(stmt) == SQLITE_DONE) {
            request->send(200, "application/json", "{\"status\":\"success\"}");
        } else {
            request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Falha ao atualizar no DB\"}");
        }

        sqlite3_finalize(stmt);
    } else {
        request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Parametros faltando.\"}");
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
        request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Missing id\"}");
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

            if (sqlite3_step(stmt) == SQLITE_DONE) {
                request->send(200, "application/json", "{\"status\":\"success\"}");
            } else {
                request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Falha ao inserir no DB\"}");
            }
        } else {
            request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Erro na query SQL\"}");
        }
        sqlite3_finalize(stmt);
    } else {
        request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Parametros faltando\"}");
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

            if (sqlite3_step(stmt) == SQLITE_DONE) {
                request->send(200, "application/json", "{\"status\":\"success\"}");
            } else {
                request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Falha ao atualizar no DB\"}");
            }
        } else {
            request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Erro na query SQL\"}");
        }
        sqlite3_finalize(stmt);
    } else {
        request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Parametros faltando\"}");
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
        request->send(500, "application/json", "{\"error\":\"Erro no banco de dados\"}");
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
        if (sqlite3_step(stmt) == SQLITE_DONE) {
            request->send(200, "application/json", "{\"status\":\"success\"}");
            ws.textAll("{\"type\":\"alert_acknowledged\"}");
        } else {
            request->send(500, "application/json", "{\"status\":\"error\", \"message\":\"Update failed\"}");
        }
        sqlite3_finalize(stmt);
    } else {
        request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Missing id or user\"}");
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
    if (sqlite3_step(stmt) == SQLITE_DONE) {
        if (strcmp(alertType, "INFO") != 0 && strcmp(alertType, "WIFI") != 0) {
            ws.textAll("{\"type\":\"new_alert\"}");
        }
    }
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

void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {
    if (type == WS_EVT_CONNECT) {
        Serial.printf("Cliente WebSocket #%u conectado\n", client->id());
        enviarEstadoSensor(ultimoEstadoSensor);
        enviarEstadoBotao(ultimoEstadoBotao);
    } else if (type == WS_EVT_DISCONNECT) {
        Serial.printf("Cliente WebSocket #%u desconectado\n", client->id());
    } else if (type == WS_EVT_DATA) {
        AwsFrameInfo *info = (AwsFrameInfo*)arg;
        if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
            data[len] = 0;
            StaticJsonDocument<200> doc;
            if (deserializeJson(doc, (char*)data).code() == DeserializationError::Ok) {
                if (strcmp(doc["type"], "botao") == 0) {
                    const char* status = doc["status"];
                    ultimoEstadoBotao = String(status);
                    enviarEstadoBotao(ultimoEstadoBotao);
                    if (ultimoEstadoBotao == "Apertado") {
                        logAlert("PANICO", "Botao de panico acionado");
                    }
                }
                else if (strcmp(doc["type"], "queda") == 0) {
                    const char* status = doc["status"];
                    if (status && strcmp(status, "detectada") == 0) {
                        const char* origem = doc["origem"];
                        String mensagemLog = "Queda detectada pelo sensor: " + String(origem ? origem : "Desconhecido");

                        Serial.printf("--- Alerta de Queda Recebido de: %s ---\n", origem ? origem : "Origem Desconhecida");

                        logAlert("QUEDA", mensagemLog.c_str());
                    }
                }
            }
        }
    }
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

void enviarEstadoBotao(String estado) {
    StaticJsonDocument<200> doc;
    doc["type"] = "botao";
    doc["status"] = estado;
    String json;
    serializeJson(doc, json);
    ws.textAll(json);
}

void verificarSensor() {
    int leitura = analogRead(MQ2_PIN);
    String estado;
    if (leitura > 2500) estado = "Fumaça Detectada";
    else if (leitura > 1800) estado = "Vazamento de Gás";
    else estado = "Ambiente Seguro";

    if (estado != ultimoEstadoSensor) {
        enviarEstadoSensor(estado);
        if (estado != "Ambiente Seguro") {
            String logMsg = "Leitura: " + String(leitura);
            const char* alertType = (estado == "Fumaça Detectada") ? "FUMACA" : "VAZAMENTO_GAS";
            logAlert(alertType, logMsg.c_str());
        }
        ultimoEstadoSensor = estado;
    }
}

void WiFiEvent(WiFiEvent_t event) {
    if (event == SYSTEM_EVENT_STA_DISCONNECTED) {
        logAlert("WIFI", "Conexao Wi-Fi perdida.");
    }
}

String getFormattedTime() {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) return "NO_TIME_DATA";
    char timeString[50];
    strftime(timeString, sizeof(timeString), "%Y-%m-%d %H:%M:%S", &timeinfo);
    return String(timeString);
}
