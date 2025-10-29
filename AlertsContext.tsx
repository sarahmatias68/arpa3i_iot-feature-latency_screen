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

type DeviceType = "pulseira" | "barreira" | "microondas" | "detector" | "gas_fumaca";

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
  updateDeviceType: (deviceId: string, newType: DeviceType | undefined) => Promise<void>;
  getDevicesByType: (type: DeviceType) => DeviceStatus[];
  getNewDevices: () => DeviceStatus[];
  acknowledgeAlert: (deviceId: string, alertType: "PANICO" | "QUEDA") => void;
  wristbandPanicActive: boolean;
  requestSystemBroadcast: () => void;
  addDevice: (deviceId: string) => Promise<void>;
  removeDevice: (deviceId: string) => Promise<void>;
}

const WEBSOCKET_URL = "ws://192.168.1.2:86/ws";
const SERVER_HTTP_BASE = "http://192.168.1.2:86";
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
    { id: "gas_fumaca", name: "Gás e Fumaça", color: "#6b7280", icon: "🔥" },
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
        // Inicializa o dispositivo virtual do sensor de gás e fumaça
        setDevicesById(prev => ({
          ...prev,
          "SENSOR_GAS_FUMACA": {
            deviceId: "SENSOR_GAS_FUMACA",
            status: "online",
            connected: true,
            lastSeen: Date.now(),
            deviceType: "gas_fumaca",
          }
        }));
        // Ao conectar, solicita um broadcast de status para reduzir a janela de offline
        setTimeout(() => {
          if (ws.current?.ws?.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({
              type: "SYSTEM_BROADCAST",
              deviceId: user?.name || "app_mobile",
              data: {
                broadcast_type: "REQUEST_DEVICE_STATUS"
              }
            });
            ws.current.ws.send(message);
          }
        }, 300);
      },

      onMessage: (event: { data: string }) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === "ping") return;
          if (data.type === "sensor") {
            setSensorState(data.tipo);
            // Atualiza o dispositivo virtual do sensor de gás e fumaça
            setDevicesById(prev => ({
              ...prev,
              "SENSOR_GAS_FUMACA": {
                deviceId: "SENSOR_GAS_FUMACA",
                status: "online",
                connected: true,
                lastSeen: Date.now(),
                deviceType: "gas_fumaca",
              }
            }));
            return;
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
                // Persiste o alerta
                AsyncStorage.setItem(`deviceAlert_${deviceId}`, JSON.stringify({
                  alertType: "PANICO",
                  timestamp: Date.now()
                })).catch(e => console.error("Erro ao salvar alerta:", e));
                
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
                // Persiste o alerta
                AsyncStorage.setItem(`deviceAlert_${deviceId}`, JSON.stringify({
                  alertType: "QUEDA",
                  timestamp: Date.now()
                })).catch(e => console.error("Erro ao salvar alerta:", e));
                
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
          // Trata mensagens diretas do servidor com status de dispositivo
          else if (data.type === "DEVICE_STATUS") {
            const statusStr = (data.status as string) || "offline";
            const isOnline = statusStr.toLowerCase() === "online";
            setDevicesById(prev => ({
              ...prev,
              [deviceId]: {
                ...(prev[deviceId] || { deviceId }),
                status: isOnline ? "online" : "offline",
                connected: isOnline,
                lastSeen: isOnline ? Date.now() : (prev[deviceId]?.lastSeen || 0),
              }
            }));
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
    const loadInitialData = async () => {
      try {
        // 1) Carrega IDs conhecidos (apenas para exibir entries offline)
        const knownIdsJson = await AsyncStorage.getItem('knownDeviceIds');
        const knownIds: string[] = knownIdsJson ? JSON.parse(knownIdsJson) : [];

        // 2) Busca tipos do servidor
        let serverTypes: Record<string, DeviceType | undefined> = {};
        try {
          const res = await fetch(`${SERVER_HTTP_BASE}/devices`);
          if (res.ok) {
            const items: Array<{ deviceId: string; deviceType: DeviceType } > = await res.json();
            items.forEach(it => { serverTypes[it.deviceId] = it.deviceType; });
          } else {
            console.warn("Falha ao obter /devices:", res.status);
          }
        } catch (e) {
          console.warn("Erro de rede ao obter /devices:", e);
        }

        // 3) Reconstrói estado inicial
        const initial: Record<string, DeviceStatus> = {};
        for (const id of knownIds) {
          const persistedAlertJson = await AsyncStorage.getItem(`deviceAlert_${id}`);
          let lastAlertType = undefined as DeviceStatus["lastAlertType"]; 
          if (persistedAlertJson) {
            const alertData = JSON.parse(persistedAlertJson);
            if (Date.now() - alertData.timestamp < 24 * 60 * 60 * 1000) {
              lastAlertType = alertData.alertType;
            } else {
              await AsyncStorage.removeItem(`deviceAlert_${id}`);
            }
          }
          initial[id] = {
            deviceId: id,
            status: 'offline',
            connected: false,
            lastSeen: 0,
            deviceType: serverTypes[id],
            lastAlertType,
          };
        }
        // Inclui quaisquer devices que só existam no servidor (têm tipo mas não estão em knownIds)
        Object.keys(serverTypes).forEach((id) => {
          if (!initial[id]) {
            initial[id] = {
              deviceId: id,
              status: 'offline',
              connected: false,
              lastSeen: 0,
              deviceType: serverTypes[id],
            };
          }
        });

        setDevicesById(initial);
      } catch (error) {
        console.error("Erro ao carregar dados iniciais:", error);
      }
    };

    loadInitialData();
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
    
    // Remove o alerta persistido
    AsyncStorage.removeItem(`deviceAlert_${deviceId}`)
      .catch(e => console.error("Erro ao remover alerta:", e));
    
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

  const updateDeviceType = async (deviceId: string, newType: DeviceType | undefined) => {
    try {
      // Atualiza estado local imediatamente
      setDevicesById(prev => ({
        ...prev,
        [deviceId]: {
          ...prev[deviceId],
          deviceId,
          deviceType: newType,
        }
      }));

      // Persiste no servidor
      if (newType === undefined) {
        // Remover tipo => deletar do registro
        const body = new URLSearchParams();
        body.append('deviceId', deviceId);
        const res = await fetch(`${SERVER_HTTP_BASE}/devices/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        if (!res.ok) console.warn('Falha ao remover tipo no servidor:', res.status);
      } else {
        // Definir/atualizar tipo => upsert
        const body = new URLSearchParams();
        body.append('deviceId', deviceId);
        body.append('type', newType);
        const res = await fetch(`${SERVER_HTTP_BASE}/devices/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        if (!res.ok) console.warn('Falha ao salvar tipo no servidor:', res.status);
      }
    } catch (error) {
      console.error("Erro ao atualizar tipo do dispositivo (servidor):", error);
    }
  };

  // Solicita explicitamente um broadcast de status dos dispositivos
  const requestSystemBroadcast = () => {
    try {
      if (ws.current?.ws?.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({
          type: "SYSTEM_BROADCAST",
          deviceId: user?.name || "app_mobile",
          data: {
            broadcast_type: "REQUEST_DEVICE_STATUS"
          }
        });
        ws.current.ws.send(message);
      } else {
        console.log("WebSocket não está aberto para solicitar broadcast.");
      }
    } catch (e) {
      console.error("Falha ao solicitar SYSTEM_BROADCAST:", e);
    }
  };

  // Adiciona manualmente um dispositivo ao registro local e persiste
  const addDevice = async (deviceId: string) => {
    try {
      setDevicesById(prev => ({
        ...prev,
        [deviceId]: prev[deviceId] || {
          deviceId,
          status: 'offline',
          connected: false,
          lastSeen: 0,
        }
      }));
      const existingIdsJson = await AsyncStorage.getItem('knownDeviceIds');
      const existingIds: string[] = existingIdsJson ? JSON.parse(existingIdsJson) : [];
      if (!existingIds.includes(deviceId)) {
        const newIds = [...existingIds, deviceId];
        await AsyncStorage.setItem('knownDeviceIds', JSON.stringify(newIds));
      }
    } catch (e) {
      console.error("Erro ao adicionar dispositivo:", e);
    }
  };

  // Remove um dispositivo do registro local e limpa persistências relacionadas
  const removeDevice = async (deviceId: string) => {
    try {
      setDevicesById(prev => {
        const copy = { ...prev };
        delete copy[deviceId];
        return copy;
      });
      const existingIdsJson = await AsyncStorage.getItem('knownDeviceIds');
      const existingIds: string[] = existingIdsJson ? JSON.parse(existingIdsJson) : [];
      const newIds = existingIds.filter(id => id !== deviceId);
      await AsyncStorage.setItem('knownDeviceIds', JSON.stringify(newIds));
      await AsyncStorage.removeItem(`deviceType_${deviceId}`);
      await AsyncStorage.removeItem(`deviceAlert_${deviceId}`);
    } catch (e) {
      console.error("Erro ao remover dispositivo:", e);
    }
  };

  const getDevicesByType = (type: DeviceType): DeviceStatus[] => {
    return Object.values(devicesById).filter(device => device.deviceType === type);
  };

  const getNewDevices = (): DeviceStatus[] => {
    return Object.values(devicesById).filter(device => !device.deviceType && device.connected);
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
    requestSystemBroadcast,
    addDevice,
    removeDevice,
  };

  return (
    <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>
  );
};

