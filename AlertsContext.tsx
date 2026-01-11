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
  tempCpuC?: number;     // Mantido para compatibilidade
  tempInternal?: number; // Novo campo v46
  heapB?: number;
  rssiDbm?: number;
  lastAlertType?: "PANICO" | "QUEDA";
  lastAlertAt?: number; // epoch ms
  deviceType?: string;
  ip?: string;
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
  timestamp?: number; // epoch ms
}

interface AlertItem {
  id: string; // server alert id ou hash local
  deviceId: string;
  type: "PANICO" | "QUEDA";
  message: string;
  timestamp: number; // epoch ms
}

// Interface para a nova Timeline v46
interface TimelineItem {
  id: number;
  timestamp: string;
  category: string;
  severity: string;
  source: string;
  description: string;
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
  alertsQueue: AlertItem[];
}

const WEBSOCKET_URL = "ws://192.168.2.131:86/ws";
const SERVER_HTTP_BASE = "http://192.168.2.131:86";
const DEVICE_TIMEOUT_MS = 11 * 60 * 1000; // 11 minutos

// Regex atualizada para suportar o novo padrão de nome v46
export const SERVER_DEVICE_PATTERN = /servidor(_central|_arpa3i)?|server/i;

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
  const [alertsQueue, setAlertsQueue] = useState<AlertItem[]>([]);
  const [wristbandPanicActive, setWristbandPanicActive] = useState<boolean>(false);
  const [devicesById, setDevicesById] = useState<Record<string, DeviceStatus>>({});
  const ws = useRef<WsConnection | null>(null);

  const deviceTypes: DeviceTypeConfig[] = [
    { id: "pulseira", name: "Pulseira Assistiva", color: "#3b82f6", icon: "watch-outline" },
    { id: "barreira", name: "Barreira", color: "#10b981", icon: "shield-outline" },
    { id: "detector", name: "Detector de Queda", color: "#ef4444", icon: "body-outline" },
    { id: "microondas", name: "Micro-ondas", color: "#f59e0b", icon: "radio-outline" },
    { id: "gas_fumaca", name: "Gás e Fumaça", color: "#6b7280", icon: "flame-outline" },
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
        if (ws.current?.ws) {
            (async () => {
              try {
                let storedId = await AsyncStorage.getItem('appDeviceId');
                if (!storedId) {
                  const base = (user?.name && user.name.trim().length > 0)
                    ? user.name.trim()
                    : (user?.email?.split('@')[0] || '');
                  if (!base) return;
                  const firstNameRaw = base.split(/\s+/)[0];
                  const firstName = firstNameRaw
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^A-Za-z0-9_]/g, '');
                  if (!firstName) return;
                  storedId = `App_${firstName}`;
                  await AsyncStorage.setItem('appDeviceId', storedId);
                }
                const identificationMsg = JSON.stringify({
                  type: 'DEVICE_STATUS',
                  deviceId: storedId,
                  status: 'online',
                });
                ws.current.ws.send(identificationMsg);
              } catch (e) {
                console.warn('Falha ao enviar identificação:', e);
              }
            })();
        }
        
        // Sensor virtual de gás
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

        // --- CARREGAMENTO DE HISTÓRICO (ADAPTADO PARA TIMELINE v46) ---
        (async () => {
          try {
            // Agora consulta /timeline em vez de /alerts
            const res = await fetch(`${SERVER_HTTP_BASE}/timeline`);
            if (res.ok) {
              const timelineEvents: TimelineItem[] = await res.json();
              
              // Filtra eventos críticos recentes que parecem ser alertas
              const criticals = timelineEvents
                .filter(e => e.category === 'ALERT' && (e.description.includes('PANICO') || e.description.includes('QUEDA')))
                .sort((a, b) => {
                  // Ordena do mais recente para o mais antigo
                  const ta = new Date(a.timestamp).getTime();
                  const tb = new Date(b.timestamp).getTime();
                  return tb - ta;
                });

              const seenJson = await AsyncStorage.getItem('seenServerAlertIds');
              const seen: Set<string> = new Set(seenJson ? JSON.parse(seenJson) : []);

              const toEnqueue: AlertItem[] = [];
              
              for (const evt of criticals) {
                // ID único baseado no ID do evento do banco
                const id = String(evt.id);
                if (seen.has(id)) continue;
                
                const ts = new Date(evt.timestamp).getTime();
                if (isNaN(ts) || (Date.now() - ts) > 24 * 60 * 60 * 1000) continue;

                // Infere o tipo baseado na descrição
                const type = evt.description.includes('PANICO') ? 'PANICO' : 'QUEDA';
                // Na v46, o 'source' é o ID do dispositivo
                const deviceId = evt.source || 'desconhecido';

                toEnqueue.push({
                  id,
                  deviceId,
                  type,
                  message: evt.description,
                  timestamp: ts,
                });

                seen.add(id);

                // Atualiza o estado do dispositivo para mostrar o alerta no card
                if (deviceId && deviceId !== 'desconhecido') {
                  setDevicesById(prev => ({
                    ...prev,
                    [deviceId]: {
                      ...(prev[deviceId] || { deviceId, status: 'offline', connected: false, lastSeen: 0 }),
                      lastAlertType: type,
                      lastAlertAt: ts,
                    }
                  }));
                }
              }

              if (toEnqueue.length) {
                setAlertsQueue(prev => [...prev, ...toEnqueue]);
                await AsyncStorage.setItem('seenServerAlertIds', JSON.stringify(Array.from(seen)));
              }
            } else {
              console.warn('Falha ao consultar timeline:', res.status);
            }
          } catch (e) {
            console.warn('Erro de rede ao consultar timeline:', e);
          }
        })();

        // Solicita broadcast de status
        setTimeout(() => {
          if (ws.current?.ws?.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({
              type: "SYSTEM_BROADCAST",
              deviceId: user?.name || "app_mobile",
              data: { broadcast_type: "REQUEST_DEVICE_STATUS" }
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
            return;
          }

          const deviceId = data.dispositivo || data.deviceId || "desconhecido";
          if (deviceId === "desconhecido") return;

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
                        lastAlertAt: Date.now(),
                        ip: data.ip || "desconhecido",
                    }
                }));
                AsyncStorage.setItem(`deviceAlert_${deviceId}`, JSON.stringify({
                  alertType: "PANICO",
                  timestamp: Date.now()
                })).catch(e => console.error(e));
                
                setAlertsQueue(prev => ([
                  ...prev,
                  {
                    id: `local-${deviceId}-PANICO-${Date.now()}`,
                    deviceId,
                    type: 'PANICO',
                    message: `Botão de pânico acionado por '${deviceId}'.`,
                    timestamp: Date.now(),
                  }
                ]));
                setWristbandPanicActive(true);
             }
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
                        lastAlertAt: Date.now(),
                        ip: data.ip || "desconhecido",
                    }
                }));
                AsyncStorage.setItem(`deviceAlert_${deviceId}`, JSON.stringify({
                  alertType: "QUEDA",
                  timestamp: Date.now()
                })).catch(e => console.error(e));
                
                setFallState({ status: "Queda Detectada", comodo: local, dispositivo: deviceId });
                setAlertsQueue(prev => ([
                  ...prev,
                  {
                    id: `local-${deviceId}-QUEDA-${Date.now()}`,
                    deviceId,
                    type: 'QUEDA',
                    message: `Queda detectada em '${local}' por '${deviceId}'.`,
                    timestamp: Date.now(),
                  }
                ]));
             }
          }
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
                uptimeSec: typeof data.uptimeSec === 'number' ? data.uptimeSec : prev[deviceId]?.uptimeSec,
                reconnects: typeof data.reconnects === 'number' ? data.reconnects : prev[deviceId]?.reconnects,
                batteryMv: typeof data.batteryMv === 'number' ? data.batteryMv : prev[deviceId]?.batteryMv,
                rssiDbm: typeof data.rssiDbm === 'number' ? data.rssiDbm : prev[deviceId]?.rssiDbm,
                heapB: typeof data.heapB === 'number' ? data.heapB : prev[deviceId]?.heapB,
                
                // Suporte Duplo: tempCpuC (Legado) e tempInternal (v46)
                tempCpuC: typeof data.tempCpuC === 'number' ? data.tempCpuC : prev[deviceId]?.tempCpuC,
                tempInternal: typeof data.tempInternal === 'number' ? data.tempInternal : prev[deviceId]?.tempInternal,
                
                ip: typeof data.ip === 'string' ? data.ip : prev[deviceId]?.ip,
              }
            }));
          }
          else if (data.type === "SYSTEM_BROADCAST") {
            const broadcastData = data.data;
            if (broadcastData?.broadcast_type === "DEVICE_STATUS") {
              const statusData = broadcastData.status_data;
              setDevicesById(prev => {
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
                  rssiDbm: statusData.wifi_rssi_dbm,
                  ip: typeof statusData.ip === 'string' ? statusData.ip : prev[deviceId]?.ip,
                };
                return { ...prev, [deviceId]: updatedDevice };
              });
            }
            else if (broadcastData?.broadcast_type === "CIENCIA_ALERTA") {
                const targetDeviceId = broadcastData.target_deviceId || deviceId;
                setDevicesById(prev => {
                    const device = prev[targetDeviceId];
                    if (device && device.lastAlertType) {
                        return { ...prev, [targetDeviceId]: { ...device, lastAlertType: undefined } };
                    }
                    return prev;
                });
                if (broadcastData.alert_source === 'PANICO') setWristbandPanicActive(false);
                if (broadcastData.alert_source === 'QUEDA') setFallState("Ativo");
            }
          }
        } catch (error) {
          console.error("Erro ao processar mensagem:", error);
        }
      },
      onClose: () => { setConnectionStatus("Desconectado"); markAllDevicesAsOffline(); },
      onError: () => { setConnectionStatus("Erro"); markAllDevicesAsOffline(); },
    };

    const socket = new WsConnection(WEBSOCKET_URL, handlers);
    ws.current = socket;
  }, [markAllDevicesAsOffline]);

  useEffect(() => {
    if (user) connect();
    return () => { ws.current?.ws?.close(); };
  }, [user, connect]);

  // Mantém activeAlert atualizado
  useEffect(() => {
    if (alertsQueue.length > 0) {
      const first = alertsQueue[0];
      setActiveAlert({
        title: first.type === 'PANICO' ? 'Alerta de Pânico!' : 'Alerta de Queda!',
        message: first.message,
        type: first.type,
        timestamp: first.timestamp,
      });
    } else {
      setActiveAlert(null);
    }
  }, [alertsQueue]);

  // Carregamento Inicial de Dados
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const knownIdsJson = await AsyncStorage.getItem('knownDeviceIds');
        const knownIds: string[] = knownIdsJson ? JSON.parse(knownIdsJson) : [];

        // 2) Busca dispositivos e tipos do servidor (agora com suporte v46)
        let serverTypes: Record<string, DeviceType | undefined> = {};
        try {
          // A rota /devices foi atualizada na v46 para retornar { id, type }
          const res = await fetch(`${SERVER_HTTP_BASE}/devices`);
          if (res.ok) {
            const items: any[] = await res.json();
            items.forEach(it => { 
                // Adaptação: v46 retorna 'id'/'type', v45 retornava 'deviceId'/'deviceType'
                // O servidor v46 manda { deviceId, deviceType } via JSON adapter, então:
                const dId = it.deviceId || it.id;
                const dType = it.deviceType || it.type;
                if (dId) serverTypes[dId] = dType; 
            });
          }
        } catch (e) {
          console.warn("Erro ao obter /devices:", e);
        }

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
          const isServer = SERVER_DEVICE_PATTERN.test(id);
          initial[id] = {
            deviceId: id,
            status: isServer ? 'online' : 'offline',
            connected: isServer,
            lastSeen: isServer ? Date.now() : 0,
            deviceType: serverTypes[id],
            lastAlertType,
          };
        }
        
        Object.keys(serverTypes).forEach((id) => {
          if (!initial[id]) {
            const isServer = SERVER_DEVICE_PATTERN.test(id);
            initial[id] = {
              deviceId: id,
              status: isServer ? 'online' : 'offline',
              connected: isServer,
              lastSeen: isServer ? Date.now() : 0,
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

  const dismissActiveAlert = () => {
    setAlertsQueue(prev => prev.slice(1));
  };

  const acknowledgeAlert = (deviceId: string, alertType: "PANICO" | "QUEDA") => {
    // 1. Envia ACK via HTTP (Padrão v46 para registrar na timeline)
    fetch(`${SERVER_HTTP_BASE}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `id=app_ack&user=${user.name || 'App'}`
    }).catch(e => console.warn('Falha ACK HTTP', e));

    // 2. Envia via WS para atualizar UI de outros Apps
    if (ws.current?.ws?.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({
            type: "SYSTEM_BROADCAST",
            deviceId: user.name || "app_mobile",
            data: {
                broadcast_type: "CIENCIA_ALERTA",
                alert_source: alertType,
                target_deviceId: deviceId,
                message: `${user.name} marcou o alerta como ciente.`
            }
        });
        ws.current.ws.send(message);
    }
    
    AsyncStorage.removeItem(`deviceAlert_${deviceId}`).catch(e => {});
    if (alertType === 'PANICO') setWristbandPanicActive(false);
    if (alertType === 'QUEDA') setFallState("Ativo");
    
    setDevicesById(prev => ({
        ...prev,
        [deviceId]: { ...prev[deviceId], lastAlertType: undefined }
    }));
    dismissActiveAlert();
  };

  const updateDeviceType = async (deviceId: string, newType: DeviceType | undefined) => {
    try {
      setDevicesById(prev => ({
        ...prev,
        [deviceId]: { ...prev[deviceId], deviceId, deviceType: newType }
      }));

      if (newType === undefined) {
        const body = new URLSearchParams(); body.append('deviceId', deviceId);
        await fetch(`${SERVER_HTTP_BASE}/devices/delete`, { method: 'POST', body });
      } else {
        const body = new URLSearchParams(); 
        body.append('deviceId', deviceId); body.append('type', newType);
        await fetch(`${SERVER_HTTP_BASE}/devices/set`, { method: 'POST', body });
      }
    } catch (error) {
      console.error("Erro ao atualizar tipo:", error);
    }
  };

  const requestSystemBroadcast = () => {
    try {
      if (ws.current?.ws?.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({
          type: "SYSTEM_BROADCAST",
          deviceId: user?.name || "app_mobile",
          data: { broadcast_type: "REQUEST_DEVICE_STATUS" }
        });
        ws.current.ws.send(message);
      }
    } catch (e) {}
  };

  const addDevice = async (deviceId: string) => {
    setDevicesById(prev => ({
      ...prev,
      [deviceId]: prev[deviceId] || { deviceId, status: 'offline', connected: false, lastSeen: 0 }
    }));
    const existingIdsJson = await AsyncStorage.getItem('knownDeviceIds');
    const existingIds: string[] = existingIdsJson ? JSON.parse(existingIdsJson) : [];
    if (!existingIds.includes(deviceId)) {
      await AsyncStorage.setItem('knownDeviceIds', JSON.stringify([...existingIds, deviceId]));
    }
  };

  const removeDevice = async (deviceId: string) => {
    setDevicesById(prev => { const copy = { ...prev }; delete copy[deviceId]; return copy; });
    const existingIdsJson = await AsyncStorage.getItem('knownDeviceIds');
    const existingIds: string[] = existingIdsJson ? JSON.parse(existingIdsJson) : [];
    await AsyncStorage.setItem('knownDeviceIds', JSON.stringify(existingIds.filter(id => id !== deviceId)));
    await AsyncStorage.removeItem(`deviceAlert_${deviceId}`);
  };

  const getDevicesByType = (type: DeviceType) => Object.values(devicesById).filter(d => d.deviceType === type);
  const getNewDevices = () => Object.values(devicesById).filter(d => !d.deviceType && !SERVER_DEVICE_PATTERN.test(d.deviceId) && d.connected);

  const value: AlertsContextType = {
    connectionStatus, sensorState, fallState, activeAlert, dismissActiveAlert,
    devicesById, deviceTypes, updateDeviceType, getDevicesByType, getNewDevices,
    acknowledgeAlert, wristbandPanicActive, requestSystemBroadcast, addDevice, removeDevice, alertsQueue
  };

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
};