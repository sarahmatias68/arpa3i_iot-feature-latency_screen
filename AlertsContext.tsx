import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WsConnection } from "./wsConnection";
import { User } from "./types/model";

// --- TIPOS ---
interface FallDetails {
  status: "Queda Detectada";
  comodo: string;
  dispositivo: string;
}
type FallState = "Desconectado" | "Ativo" | FallDetails;

interface DeviceStatus {
  deviceId: string;
  status: "online" | "offline";
  connected: boolean;
  lastSeen: number;
  uptimeSec?: number;
  reconnects?: number;
  batteryMv?: number;
  tempCpuC?: number;
  heapB?: number;
  rssiDbm?: number;
  lastAlertType?: "PANICO" | "QUEDA";
  deviceType?: string;
}

type DeviceType = "pulseira" | "barreira" | "microondas" | "detector" | "outros";

interface DeviceTypeConfig {
  id: DeviceType;
  name: string;
  color: string;
  icon: string;
}

type ConnectionStatus =
  | "Desconectado"
  | "Conectando..."
  | "Conectado"
  | "Finalizando conexão..."
  | "Erro";
type SensorState = "Servidor Desconectado" | "" | string;

interface ActiveAlert {
    title: string;
    message: string;
    type: "PANICO" | "QUEDA";
}

interface AlertsContextType {
  connectionStatus: ConnectionStatus;
  sensorState: SensorState;
  fallState: FallState;
  activeAlert: ActiveAlert | null;
  dismissActiveAlert: () => void;
  devicesById: Record<string, DeviceStatus>;
  deviceTypes: DeviceTypeConfig[];
  updateDeviceType: (deviceId: string, newType: DeviceType) => Promise<void>;
  getDevicesByType: (type: DeviceType) => DeviceStatus[];
  getNewDevices: () => DeviceStatus[];
  acknowledgeAlert: (deviceId: string, alertType: "PANICO" | "QUEDA") => void;
  wristbandPanicActive: boolean;
}

const WEBSOCKET_URL = "ws://192.168.2.115:86/ws";
const DEVICE_TIMEOUT_MS = 11 * 60 * 1000; // 11 minutos

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
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("Desconectado");
  const [sensorState, setSensorState] = useState<SensorState>("Desconectado");
  const [fallState, setFallState] = useState<FallState>("Desconectado");
  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);
  const [wristbandPanicActive, setWristbandPanicActive] = useState<boolean>(false);
  const [devicesById, setDevicesById] = useState<Record<string, DeviceStatus>>({});
  const ws = useRef<WsConnection | null>(null);

  const deviceTypes: DeviceTypeConfig[] = [
    { id: "pulseira", name: "Pulseira Assistiva", color: "#3b82f6", icon: "⌚" },
    { id: "barreira", name: "Barreira", color: "#10b981", icon: "🚧" },
    { id: "detector", name: "Detector de Queda", color: "#ef4444", icon: "📱" },
    { id: "microondas", name: "Micro-ondas", color: "#f59e0b", icon: "📡" },
    { id: "outros", name: "Outros", color: "#6b7280", icon: "🔧" },
  ];

  const markAllDevicesAsOffline = useCallback(() => {
    setDevicesById(prev => {
        const newDevices = { ...prev };
        Object.keys(newDevices).forEach(key => {
            newDevices[key] = { ...newDevices[key], connected: false, status: 'offline' };
        });
        return newDevices;
    });
  }, []);

  const connect = useCallback(() => {
    setConnectionStatus("Conectando...");

    const handlers = {
      onOpen: () => {
        setConnectionStatus("Conectado");
      },

      onMessage: (event: { data: string }) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === "ping") return;
          if (data.type === "sensor") {
            setSensorState(data.tipo);
            return; // Finaliza o processamento para esta mensagem
          }

          // <<-- CORREÇÃO: Lógica unificada para extrair deviceId -->>
          const deviceId = data.dispositivo || data.deviceId || "desconhecido";
          if (deviceId === "desconhecido") {
            console.warn("Mensagem recebida sem deviceId ou dispositivo:", data);
            return; // Ignora mensagens sem um ID válido
          }

          if (data.type === "ALERTA") {
             if (data.sub_type === "PANICO") {
                setDevicesById(prev => ({
                    ...prev,
                    [deviceId]: {
                        ...(prev[deviceId] || { deviceId }),
                        lastAlertType: "PANICO",
                        connected: true,
                        status: "online",
                        lastSeen: Date.now(),
                    }
                }));
                setActiveAlert({
                    title: "🚨 ALERTA DE PÂNICO!",
                    message: `Botão de pânico acionado pelo dispositivo '${deviceId}'.`,
                    type: "PANICO"
                });
                setWristbandPanicActive(true);
             }
             // <<-- CORREÇÃO: Lógica para Alerta de Queda adicionada -->>
             else if (data.sub_type === "QUEDA") {
                const local = data.detalhes?.local || "local desconhecido";
                setDevicesById(prev => ({
                    ...prev,
                    [deviceId]: {
                        ...(prev[deviceId] || { deviceId }),
                        lastAlertType: "QUEDA",
                        connected: true,
                        status: "online",
                        lastSeen: Date.now(),
                    }
                }));
                const fallDetails: FallDetails = {
                    status: "Queda Detectada",
                    comodo: local,
                    dispositivo: deviceId,
                };
                setFallState(fallDetails);
                setActiveAlert({
                    title: "⚠️ ALERTA DE QUEDA!",
                    message: `Queda detectada em '${local}' pelo dispositivo '${deviceId}'.`,
                    type: "QUEDA"
                });
             }
          }
          else if (data.type === "sensor") {
            setSensorState(data.tipo);
          }
          else if (data.type === "SYSTEM_BROADCAST") {
            const broadcastData = data.data;
            
            if (broadcastData?.broadcast_type === "DEVICE_STATUS") {
              const statusData = broadcastData.status_data;
              
              setDevicesById(prev => {
                const isNewDevice = !prev[deviceId];
                if (isNewDevice) {
                  const updateKnownIds = async () => {
                    try {
                      const existingIdsJson = await AsyncStorage.getItem('knownDeviceIds');
                      const existingIds = existingIdsJson ? JSON.parse(existingIdsJson) : [];
                      if (!existingIds.includes(deviceId)) {
                        const newIds = [...existingIds, deviceId];
                        await AsyncStorage.setItem('knownDeviceIds', JSON.stringify(newIds));
                      }
                    } catch (e) { console.error("Falha ao salvar ID de novo dispositivo", e); }
                  };
                  updateKnownIds();
                }

                const currentDevice = prev[deviceId] || { deviceId };
                
                const updatedDevice: DeviceStatus = {
                  ...currentDevice,
                  status: "online",
                  connected: true,
                  lastSeen: Date.now(),
                  uptimeSec: statusData.uptime_ms ? statusData.uptime_ms / 1000 : undefined,
                  reconnects: statusData.reconnects,
                  batteryMv: statusData.tensao_mV ? Number(statusData.tensao_mV) : undefined,
                  tempCpuC: statusData.temp_cpu_c,
                  heapB: statusData.free_heap_b,
                  rssiDbm: statusData.wifi_rssi_dbm,
                };
                
                return { ...prev, [deviceId]: updatedDevice };
              });
            }
            else if (broadcastData?.broadcast_type === "CIENCIA_ALERTA") {
                const targetDeviceId = broadcastData.target_deviceId || deviceId;
                setDevicesById(prev => {
                    const device = prev[targetDeviceId];
                    if (device && device.lastAlertType) {
                        const updatedDevice = { ...device, lastAlertType: undefined };
                        return { ...prev, [targetDeviceId]: updatedDevice };
                    }
                    return prev;
                });
                if (broadcastData.alert_source === 'PANICO') {
                    setWristbandPanicActive(false);
                }
                if (broadcastData.alert_source === 'QUEDA') {
                    setFallState("Ativo");
                }
            }
          }
        } catch (error) {
          console.error("Erro ao processar mensagem:", error);
        }
      },

      onClose: () => {
        setConnectionStatus("Desconectado");
        markAllDevicesAsOffline();
      },
      onError: () => {
        setConnectionStatus("Erro");
        markAllDevicesAsOffline();
      },
    };

    const socket = new WsConnection(WEBSOCKET_URL, handlers);
    ws.current = socket;
  }, [markAllDevicesAsOffline]);

  useEffect(() => {
    if (user) {
      connect();
    }
    return () => {
      ws.current?.ws?.close();
    };
  }, [user, connect]);

  useEffect(() => {
    const loadPersistedData = async () => {
      try {
        const knownIdsJson = await AsyncStorage.getItem('knownDeviceIds');
        if (!knownIdsJson) return;

        const knownIds = JSON.parse(knownIdsJson);
        const initialDevicesState: Record<string, DeviceStatus> = {};

        for (const deviceId of knownIds) {
          const persistedType = await AsyncStorage.getItem(`deviceType_${deviceId}`);
          initialDevicesState[deviceId] = {
            deviceId,
            status: 'offline',
            connected: false,
            lastSeen: 0,
            deviceType: persistedType as DeviceType || undefined,
          };
        }
        setDevicesById(initialDevicesState);
      } catch (error) {
        console.error("Erro ao carregar tipos de dispositivos:", error);
      }
    };

    loadPersistedData();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
        setDevicesById(prev => {
            const now = Date.now();
            const updatedDevices = { ...prev };
            let changed = false;

            for (const deviceId in updatedDevices) {
                const device = updatedDevices[deviceId];
                if (device.connected && now - device.lastSeen > DEVICE_TIMEOUT_MS) {
                    updatedDevices[deviceId] = { ...device, status: 'offline', connected: false };
                    changed = true;
                }
            }
            return changed ? updatedDevices : prev;
        });
    }, 60 * 1000);

    return () => clearInterval(interval);
  }, []);
  
  const dismissActiveAlert = () => {
    setActiveAlert(null);
  };

  // <<-- CORREÇÃO: Função unificada para dar ciência dos alertas -->>
  const acknowledgeAlert = (deviceId: string, alertType: "PANICO" | "QUEDA") => {
    if (ws.current?.ws?.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({
            type: "SYSTEM_BROADCAST",
            deviceId: user.name || "app_mobile",
            data: {
                broadcast_type: "CIENCIA_ALERTA",
                alert_source: alertType,
                target_deviceId: deviceId,
                message: `${user.name} marcou o alerta de ${alertType} como ciente.`
            }
        });
        ws.current.ws.send(message);
    }
    
    // Limpa o estado local
    if (alertType === 'PANICO') setWristbandPanicActive(false);
    if (alertType === 'QUEDA') setFallState("Ativo");
    
    setDevicesById(prev => ({
        ...prev,
        [deviceId]: {
            ...prev[deviceId],
            lastAlertType: undefined,
        }
    }));
    dismissActiveAlert();
  };

  const updateDeviceType = async (deviceId: string, newType: DeviceType) => {
    try {
      setDevicesById(prev => ({
        ...prev,
        [deviceId]: {
          ...prev[deviceId],
          deviceId,
          deviceType: newType,
        }
      }));
      await AsyncStorage.setItem(`deviceType_${deviceId}`, newType);
    } catch (error) {
      console.error("Erro ao atualizar tipo do dispositivo:", error);
    }
  };

  const getDevicesByType = (type: DeviceType): DeviceStatus[] => {
    return Object.values(devicesById).filter(device => device.deviceType === type);
  };

  const getNewDevices = (): DeviceStatus[] => {
    return Object.values(devicesById).filter(device => !device.deviceType);
  };

  const value: AlertsContextType = {
    connectionStatus,
    sensorState,
    fallState,
    activeAlert,
    dismissActiveAlert,
    devicesById,
    deviceTypes,
    updateDeviceType,
    getDevicesByType,
    getNewDevices,
    acknowledgeAlert,
    wristbandPanicActive,
  };

  return (
    <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>
  );
};

