import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { Alert } from "react-native";
import { WsConnection } from "./wsConnection";
import { User } from "./types/model";

// --- TIPOS ATUALIZADOS PARA COMPATIBILIDADE COM SERVIDOR ESP32 ---
interface FallDetails {
  status: "Queda Detectada";
  comodo: string;
  dispositivo: string;
}
type FallState = "Desconectado" | "Ativo" | FallDetails;

// Novos tipos para dispositivos e heartbeat
interface DeviceStatus {
  deviceId: string;
  status: "online" | "offline";
  lastSeen?: string;
  uptime?: number;
  reconnects?: number;
  battery?: number;
  temperature?: number;
  heap?: number;
  rssi?: number;
}

interface HeartbeatData {
  uptime_ms: number;
  reconnects: number;
  tensao_mV?: number;
  temp_cpu_c?: number;
  free_heap_b?: number;
  wifi_rssi_dbm?: number;
}

type ConnectionStatus =
  | "Desconectado"
  | "Conectando..."
  | "Conectado"
  | "Finalizando conexão..."
  | "Erro";
type SensorState = "Servidor Desconectado" | "" | string;
type ButtonState = "Desconectado" | "" | string;
interface ActiveAlert {
  title: string;
  message: string;
  type: string;
}
interface AlertItem {
  id: string;
  alert_type: string;
  timestamp: string;
  acknowledged_by?: string;
  [key: string]: any;
}
interface AlertsContextType {
  connectionStatus: ConnectionStatus;
  sensorState: SensorState;
  buttonState: ButtonState;
  fallState: FallState;
  activeAlert: ActiveAlert | null;
  dismissActiveAlert: () => void;
  allAlerts: AlertItem[];
  fetchAlerts: () => Promise<void>;
  acknowledgeAlertInList: (id: string) => Promise<void>;
  devices: DeviceStatus[];
  sendDeviceId: (deviceId: string) => void;
}

const WEBSOCKET_URL = "ws://192.168.2.115:86/ws";
const API_URL = "http://192.168.2.115:86";

const AlertsContext = createContext<AlertsContextType | undefined>(undefined);

export function useAlerts(): AlertsContextType {
  const context = useContext(AlertsContext);
  if (!context) {
    throw new Error("useAlerts must be used within an AlertsProvider");
  }
  return context;
}

interface AlertsProviderProps {
  children: ReactNode;
  user: User;
}

export const AlertsProvider: React.FC<AlertsProviderProps> = ({
  children,
  user,
}) => {
  const [states, setStates] = useState<{
    connectionStatus: ConnectionStatus;
    sensorState: SensorState;
    buttonState: ButtonState;
    fallState: FallState;
  }>({
    connectionStatus: "Desconectado",
    sensorState: "Servidor Desconectado",
    buttonState: "Desconectado",
    fallState: "Desconectado",
  });

  // Função atualizada para aceitar o novo tipo de FallState
  const handleStateChange = (state: keyof typeof states, value: string | FallDetails) => {
    setStates((prev) => ({ ...prev, [state]: value }));
  };

  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);
  const [allAlerts, setAllAlerts] = useState<AlertItem[]>([]);
  const [devices, setDevices] = useState<DeviceStatus[]>([]);
  const ws = useRef<WsConnection | null>(null);

  const connect = useCallback(() => {
    handleStateChange("connectionStatus", "Conectando...");

    const handlers = {
      onOpen: () => {
        handleStateChange("connectionStatus", "Conectado");
        handleStateChange("sensorState", "Ambiente Seguro");
        handleStateChange("buttonState", "Conectado");
        handleStateChange("fallState", "Conectado");
      },

      // LÓGICA DE MENSAGEM ATUALIZADA PARA SERVIDOR ESP32
      onMessage: (event: { data: string }) => {
        try {
          const data = JSON.parse(event.data);
          console.log("📨 Mensagem recebida:", data);
          
          if (data.type === "ping") return;

          // Processar alertas do servidor
          if (data.type === "ALERTA") {
            if (data.sub_type === "QUEDA") {
              const fallDetails: FallDetails = {
                status: "Queda Detectada",
                comodo: data.detalhes?.local || "desconhecido",
                dispositivo: data.dispositivo || "desconhecido",
              };

              handleStateChange("fallState", fallDetails);

              setActiveAlert({
                title: "⚠️ ALERTA DE QUEDA DETECTADA!",
                message: `Queda detectada no local '${fallDetails.comodo}' pelo dispositivo '${fallDetails.dispositivo}'.`,
                type: "QUEDA"
              });
            } else if (data.sub_type === "PANICO") {
              setActiveAlert({
                title: "🚨 ALERTA DE PÂNICO!",
                message: `Botão de pânico acionado pelo dispositivo '${data.dispositivo || 'desconhecido'}'.`,
                type: "PANICO"
              });
            }
          }
          // Processar status de dispositivos
          else if (data.type === "DEVICE_STATUS") {
            const deviceId = data.deviceId;
            const status = data.status;
            
            setDevices(prev => {
              const existing = prev.find(d => d.deviceId === deviceId);
              if (existing) {
                return prev.map(d => 
                  d.deviceId === deviceId 
                    ? { ...d, status, lastSeen: new Date().toISOString() }
                    : d
                );
              } else {
                return [...prev, { deviceId, status, lastSeen: new Date().toISOString() }];
              }
            });
          }
          // Processar heartbeat com dados completos
          else if (data.type === "HEARTBEAT") {
            const deviceId = data.deviceId || "desconhecido";
            const heartbeatData: HeartbeatData = data.data;
            
            // Atualizar status do dispositivo
            setDevices(prev => {
              const existing = prev.find(d => d.deviceId === deviceId);
              const deviceData: DeviceStatus = {
                deviceId,
                status: "online",
                lastSeen: new Date().toISOString(),
                uptime: heartbeatData.uptime_ms / 1000,
                reconnects: heartbeatData.reconnects,
                battery: heartbeatData.tensao_mV,
                temperature: heartbeatData.temp_cpu_c,
                heap: heartbeatData.free_heap_b,
                rssi: heartbeatData.wifi_rssi_dbm,
              };
              
              if (existing) {
                return prev.map(d => d.deviceId === deviceId ? deviceData : d);
              } else {
                return [...prev, deviceData];
              }
            });

            // Verificar bateria fraca
            if (heartbeatData.tensao_mV && heartbeatData.tensao_mV < 3200) {
              setActiveAlert({
                title: "🔋 BATERIA FRACA!",
                message: `Dispositivo '${deviceId}' com bateria baixa: ${heartbeatData.tensao_mV}mV`,
                type: "BATERIA_FRACA"
              });
            }
          }
          // Processar dados do sensor
          else if (data.type === "sensor" && data.tipo) {
            handleStateChange("sensorState", data.tipo);
          }
          // Processar confirmação de ciência
          else if (data.type === "ACK") {
            console.log(`✅ Confirmação recebida para alerta: ${data.acked_alert}`);
          }
        } catch (error) {
          console.error("Erro ao processar mensagem:", error);
        }
      },

      onClose: () => {
        handleStateChange("connectionStatus", "Desconectado");
        handleStateChange("sensorState", "Servidor Desconectado");
        handleStateChange("buttonState", "Desconectado");
        handleStateChange("fallState", "Desconectado");
      },
      onError: () => {
        handleStateChange("connectionStatus", "Erro");
        handleStateChange("sensorState", "Servidor Desconectado");
        handleStateChange("buttonState", "Desconectado");
        handleStateChange("fallState", "Desconectado");
      },
    };

    const socket = new WsConnection(WEBSOCKET_URL, handlers);
    ws.current = socket;
  }, []);

  useEffect(() => {
    if (user && !ws.current) {
      connect();
    }
    return () => {
      if (ws.current && ws.current.ws) {
        ws.current.ws.close();
      }
    };
  }, [user, connect]);
  
  const dismissActiveAlert = () => {
    setActiveAlert(null);
    // Ao dispensar, o card volta ao estado normal
    handleStateChange("fallState", "Conectado");
  };

  const sendDeviceId = useCallback((deviceId: string) => {
    if (ws.current && ws.current.ws && ws.current.ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "deviceId",
        deviceId: deviceId
      });
      ws.current.ws.send(message);
      console.log(`📤 Enviando deviceId: ${deviceId}`);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/alerts`);
      if (response.ok) {
        const alerts = await response.json();
        setAllAlerts(alerts);
      }
    } catch (error) {
      console.error("Erro ao buscar alertas:", error);
    }
  }, []);

  const acknowledgeAlertInList = async (id: string) => {
    try {
      const response = await fetch(`${API_URL}/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `id=${id}&user=${user.name}`
      });
      
      if (response.ok) {
        await fetchAlerts();
        // Enviar confirmação via WebSocket
        if (ws.current && ws.current.ws && ws.current.ws.readyState === WebSocket.OPEN) {
          const message = JSON.stringify({
            type: "ACK_ALERTA",
            user: user.name
          });
          ws.current.ws.send(message);
        }
      }
    } catch (error) {
      console.error("Erro ao confirmar alerta:", error);
    }
  };

  const value: AlertsContextType = {
    connectionStatus: states.connectionStatus,
    sensorState: states.sensorState,
    buttonState: states.buttonState,
    fallState: states.fallState,
    activeAlert,
    dismissActiveAlert,
    allAlerts,
    fetchAlerts,
    acknowledgeAlertInList,
    devices,
    sendDeviceId,
  };

  return (
    <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>
  );
};