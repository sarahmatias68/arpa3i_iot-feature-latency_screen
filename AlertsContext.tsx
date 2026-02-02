import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WsConnection } from "./wsConnection";
import { User } from "./types/model";
const MAIN_GATE_ID = "Portao_6C0878";
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
  lastAlertAt?: number; // epoch ms
  deviceType?: string;
  ip?: string;
  gateState?: string;
}

type DeviceType = "pulseira" | "barreira" | "microondas" | "detector" | "gas_fumaca" | "automacao" | "servidor" | "portao";

// Interface define o formato de CADA tipo
interface DeviceTypeConfig {
  name: string;
  icon: string;
  color: string;
  capability: 'sensor' | 'atuador' | 'sistema';
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

interface AlertsContextType {
  connectionStatus: ConnectionStatus;
  sensorState: SensorState;
  fallState: FallState;
  activeAlert: ActiveAlert | null; // compat: reflete o primeiro item da fila
  dismissActiveAlert: () => void;
  devicesById: Record<string, DeviceStatus>;
  updateDeviceType: (deviceId: string, newType: DeviceType | undefined) => Promise<void>;
  getDevicesByType: () => Record<string, DeviceStatus[]>;
  getNewDevices: () => DeviceStatus[];
  acknowledgeAlert: (deviceId: string, alertType: "PANICO" | "QUEDA") => void;
  wristbandPanicActive: boolean;
  requestSystemBroadcast: () => void;
  addDevice: (deviceId: string) => Promise<void>;
  removeDevice: (deviceId: string) => Promise<void>;
  enviarComando: (targetId: string, action: string) => void;
  deviceTypes: Record<DeviceType, DeviceTypeConfig>; // Acesso rápido (Objeto)
  getDeviceTypesList: () => ({ id: DeviceType } & DeviceTypeConfig)[]; // Para menus (Array)
  // fila
  alertsQueue: AlertItem[];
}

const WEBSOCKET_URL = "wss://app.arpa3i.me/ws";
const SERVER_HTTP_BASE = "https://painel.arpa3i.me";
const DEVICE_TIMEOUT_MS = 11 * 60 * 1000; // 11 minutos
export const SERVER_DEVICE_PATTERN = /servidor(_central)?|server/i;

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
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("Conectando...");
  const [sensorState, setSensorState] = useState<SensorState>("Desconectado");
  const [fallState, setFallState] = useState<FallState>("Desconectado");
  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);
  const [alertsQueue, setAlertsQueue] = useState<AlertItem[]>([]);
  const [wristbandPanicActive, setWristbandPanicActive] = useState<boolean>(false);
  const [devicesById, setDevicesById] = useState<Record<string, DeviceStatus>>({});
  const ws = useRef<WsConnection | null>(null);
  const hasHandshaked = useRef(false);
  const myAppId = useRef("App_Desconhecido");

  // FASE 4.1: Mapa Inteligente (Objeto para acesso rápido)
  const deviceTypes: Record<DeviceType, DeviceTypeConfig> = {
    // SENSORES (Monitoramento)
    pulseira:   { name: "Pulseira de Pânico", icon: "accessibility-outline", color: "#facc15", capability: 'sensor' },
    barreira:   { name: "Barreira IV",        icon: "scan-outline",          color: "#f87171", capability: 'sensor' },
    microondas: { name: "Radar Micro-ondas",  icon: "radio-outline",         color: "#60a5fa", capability: 'sensor' },
    detector:   { name: "Detector de Queda",  icon: "body-outline",          color: "#c084fc", capability: 'sensor' },
    gas_fumaca: { name: "Sensor Gás/Fumaça",  icon: "flame-outline",         color: "#fb923c", capability: 'sensor' },
    
    // ATUADORES (Controle)
    automacao:  { name: "Automação Genérica", icon: "power-outline",         color: "#8b5cf6", capability: 'atuador' },
    portao:     { name: "Portão Eletrônico",  icon: "car-sport-outline",     color: "#10b981", capability: 'atuador' },
    
    // SISTEMA
    servidor:   { name: "Servidor Central",   icon: "server-outline",        color: "#475569", capability: 'sistema' },
  };

  // --- NOVO: Converte o Objeto em Lista para menus ---
  const getDeviceTypesList = useCallback(() => {
    return (Object.keys(deviceTypes) as DeviceType[]).map(key => ({
      id: key,
      ...deviceTypes[key]
    }));
  }, []);

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

        // Busca no servidor por alertas pendentes recentes (fallback quando o app estava fechado no momento do alerta)
        (async () => {
          try {
            const res = await fetch(`${SERVER_HTTP_BASE}/alerts?status=pending`);
            if (res.ok) {
              const alerts: any[] = await res.json();
              // Filtra apenas PANICO/QUEDA, ordena por timestamp desc e enfileira todos os não vistos
              const criticals = alerts
                .filter(a => a.alert_type === 'PANICO' || a.alert_type === 'QUEDA')
                .sort((a, b) => {
                  const ta = new Date(a.timestamp).getTime();
                  const tb = new Date(b.timestamp).getTime();
                  return tb - ta;
                });

              const seenJson = await AsyncStorage.getItem('seenServerAlertIds');
              const seen: Set<string> = new Set(seenJson ? JSON.parse(seenJson) : []);

              const toEnqueue: AlertItem[] = [];
              for (const it of criticals) {
                const id = String(it.id ?? `${it.alert_type}-${it.timestamp}-${it.message}`);
                if (seen.has(id)) continue;
                const ts = new Date(it.timestamp).getTime();
                if (isNaN(ts) || (Date.now() - ts) > 24 * 60 * 60 * 1000) continue;

                // extrai deviceId da mensagem como fallback
                const msg: string = it.message || '';
                let parsedDeviceId = '';
                const mP = msg.match(/panico acionado por:\s*([^\s]+)/i);
                const mQ = msg.match(/Queda detectada por:\s*([^\s]+)/i);
                if (mP && mP[1]) parsedDeviceId = mP[1];
                else if (mQ && mQ[1]) parsedDeviceId = mQ[1];

                toEnqueue.push({
                  id,
                  deviceId: parsedDeviceId || 'desconhecido',
                  type: it.alert_type,
                  message: msg,
                  timestamp: ts,
                });

                seen.add(id);

                if (parsedDeviceId) {
                  setDevicesById(prev => ({
                    ...prev,
                    [parsedDeviceId]: {
                      ...(prev[parsedDeviceId] || { deviceId: parsedDeviceId, status: 'offline', connected: false, lastSeen: 0 }),
                      lastAlertType: it.alert_type,
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
              console.warn('Falha ao consultar /alerts:', res.status);
            }
          } catch (e) {
            console.warn('Erro de rede ao consultar /alerts:', e);
          }
        })();
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
                        lastAlertAt: Date.now(),
                        ip: data.ip || "desconhecido",
                    }
                }));
                // Persiste o alerta
                AsyncStorage.setItem(`deviceAlert_${deviceId}`, JSON.stringify({
                  alertType: "PANICO",
                  timestamp: Date.now()
                })).catch(e => console.error("Erro ao salvar alerta:", e));
                // Enfileira
                setAlertsQueue(prev => ([
                  ...prev,
                  {
                    id: `local-${deviceId}-PANICO-${Date.now()}`,
                    deviceId,
                    type: 'PANICO',
                    message: `Botão de pânico acionado pelo dispositivo '${deviceId}'.`,
                    timestamp: Date.now(),
                  }
                ]));
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
                        lastAlertAt: Date.now(),
                        ip: data.ip || "desconhecido",
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
                // Enfileira
                setAlertsQueue(prev => ([
                  ...prev,
                  {
                    id: `local-${deviceId}-QUEDA-${Date.now()}`,
                    deviceId,
                    type: 'QUEDA',
                    message: `Queda detectada em '${local}' pelo dispositivo '${deviceId}'.`,
                    timestamp: Date.now(),
                  }
                ]));
             }
          }
          else if (data.type === "ESTADO") {
            const newState = data.payload?.estado;
            if (newState) {
              setDevicesById(prev => ({
                ...prev,
                [deviceId]: {
                  ...(prev[deviceId] || { deviceId }),
                  gateState: newState,
                  // Garante que o dispositivo seja marcado como online ao receber um estado
                  status: "online",
                  connected: true,
                  lastSeen: Date.now(),
                }
              }));
            }
          }
          else if (data.type === "sensor") {
            setSensorState(data.tipo);
          }
          // Trata mensagens diretas do servidor com status de dispositivo
          // ------------------------------------------------------------------
          // PROTOCOLO PADRONIZADO (MODO ESTRITO)
          // ------------------------------------------------------------------
          else if (data.type === "DEVICE_STATUS") {
            // Validação de Integridade: O payload é obrigatório.
            if (!data.payload) {
              console.warn(`⚠️ Protocolo Inválido: ${deviceId} enviou DEVICE_STATUS sem payload.`);
              return; 
            }

            const payload = data.payload;
            const isOnline = payload.status === "online";

            setDevicesById(prev => {
              const prevDevice = prev[deviceId];
              
              // Mapeamento Estrito: Protocolo Universal -> Estado do App
              // Não há "fallback" para a raiz. A fonte da verdade é o payload.
              return {
                ...prev,
                [deviceId]: {
                  ...(prevDevice || { deviceId }), // Mantém base anterior
                  
                  // 1. Status Vital
                  status: isOnline ? "online" : "offline",
                  connected: isOnline,
                  lastSeen: isOnline ? Date.now() : (prevDevice?.lastSeen || 0),
                  
                  // 2. Mapeamento de Campos (De -> Para)
                  // O protocolo envia 'state' (genérico). O App usa 'gateState' (para UI de portão).
                  gateState: payload.state || prevDevice?.gateState, 
                  
                  // 3. Telemetria Direta
                  uptimeSec:  payload.uptimeSec,
                  reconnects: payload.reconnects,
                  batteryMv:  payload.batteryMv,
                  rssiDbm:    payload.rssiDbm,
                  ip:         payload.ip,
                  heapB:      payload.heapB,
                  
                  // O firmware envia 'tempCpu'. O App espera 'tempCpuC'.
                  tempCpuC:   payload.tempCpu,
                }
              };
            });
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

  // Reidentifica com primeiro nome quando ficar disponível após a conexão
  useEffect(() => {
    (async () => {
      const sock = ws.current?.ws;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      try {
        const base = (user?.name && user.name.trim().length > 0)
          ? user.name.trim()
          : (user?.email?.split('@')[0] || 'Cuidador');
        const firstNameRaw = base.split(/\s+/)[0];
        const firstName = firstNameRaw
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^A-Za-z0-9_]/g, '') || 'Cuidador';
        const newId = `App_${firstName}`;
        let storedId = await AsyncStorage.getItem('appDeviceId');
        if (!storedId || storedId !== newId) {
          await AsyncStorage.setItem('appDeviceId', newId);
          storedId = newId;
        }
        const identificationMsg = JSON.stringify({
          type: 'DEVICE_STATUS',
          deviceId: storedId,
          status: 'online',
        });
        sock.send(identificationMsg);
      } catch (e) {
        // silencioso para não atrapalhar UI
      }
    })();
  }, [user?.name, user?.email]);

  // Mantém activeAlert sempre refletindo o primeiro item da fila
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
        // Inclui quaisquer devices que só existam no servidor (têm tipo mas não estão em knownIds)
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

        // Reidrata visual do alerta: coloca na fila o primeiro que tiver lastAlertType
        const firstWithAlert = Object.values(initial).find(d => d.lastAlertType);
        if (firstWithAlert?.lastAlertType === "PANICO") {
          setAlertsQueue(prev => ([
            ...prev,
            {
              id: `rehydrate-${firstWithAlert.deviceId}-PANICO-${Date.now()}`,
              deviceId: firstWithAlert.deviceId,
              type: 'PANICO',
              message: `Botão de pânico acionado pelo dispositivo '${firstWithAlert.deviceId}'.`,
              timestamp: Date.now(),
            }
          ]));
          setWristbandPanicActive(true);
        } else if (firstWithAlert?.lastAlertType === "QUEDA") {
          setAlertsQueue(prev => ([
            ...prev,
            {
              id: `rehydrate-${firstWithAlert.deviceId}-QUEDA-${Date.now()}`,
              deviceId: firstWithAlert.deviceId,
              type: 'QUEDA',
              message: `Queda detectada pelo dispositivo '${firstWithAlert.deviceId}'.`,
              timestamp: Date.now(),
            }
          ]));
          setFallState({
            status: "Queda Detectada",
            comodo: "indefinido",
            dispositivo: firstWithAlert.deviceId,
          });
        }
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
    // remove o primeiro item da fila
    setAlertsQueue(prev => prev.slice(1));
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

// CORREÇÃO: Adicionado useCallback para impedir recriação da função
  const requestSystemBroadcast = useCallback(() => {
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
  }, [user]); // Dependência estável

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

const getDevicesByType = useCallback(() => {
    if (!devicesById) return {};
    
    const grouped: Record<string, DeviceStatus[]> = {};
    
    Object.values(devicesById).forEach(device => {
      if (device.deviceType === 'servidor') return;

      let groupKey = device.deviceType;
      
      if (device.deviceType === 'portao') {
        groupKey = 'automacao';
      }

      if (!grouped[groupKey]) {
        grouped[groupKey] = [];
      }
      
      grouped[groupKey].push(device);
    });
    
    return grouped;
  }, [devicesById]);

  const getNewDevices = (): DeviceStatus[] => {
    return Object.values(devicesById).filter(device => {
      if (device.deviceType) return false; // já tipados não são "novos"
      if (SERVER_DEVICE_PATTERN.test(device.deviceId)) return false; // o servidor nunca entra aqui
      if (!device.connected) return false; // requer conexão ativa
      // Heurística para excluir apps: exigir sinais típicos de hardware (métricas ou alertas)
      const hasMetrics = (
        typeof device.batteryMv === 'number' ||
        typeof device.uptimeSec === 'number' ||
        typeof device.rssiDbm === 'number' ||
        typeof device.heapB === 'number' ||
        typeof device.tempCpuC === 'number'
      );
      const hasAlert = !!device.lastAlertType;
      return hasMetrics || hasAlert;
    });
  };

// CORREÇÃO: Adicionado useCallback para impedir loop no useEffect
  const enviarComando = useCallback((targetId: string, action: string) => {
    if (ws.current?.ws && connectionStatus === "Conectado") {
      const payload = {
        type: "COMANDO",
        target: targetId,
        payload: {
          action: action,
          sender: myAppId.current
        }
      };

      console.log("Enviando comando:", payload);
      ws.current.ws.send(JSON.stringify(payload));
    } else {
      console.log("Erro: Socket desconectado. Não foi possível enviar.");
    }
  }, [connectionStatus]); // Dependência estável

// --- HANDSHAKE AUTOMÁTICO & IDENTIFICAÇÃO ---
  useEffect(() => {
    // 1. Reset da trava se cair a conexão
    if (connectionStatus !== 'Conectado') {
      hasHandshaked.current = false;
      return;
    }

    // 2. Ao conectar, executa o protocolo de entrada
    if (connectionStatus === 'Conectado' && !hasHandshaked.current) {
      console.log("🎮 [Context] Conectado. Iniciando Protocolo de Identificação...");
      hasHandshaked.current = true; // Trava imediata

      // --- PASSO A: ENVIAR IDENTIDADE (QUEM SOU EU?) ---
      const enviarIdentidade = async () => {
          if (ws.current?.ws?.readyState === WebSocket.OPEN) {
              try {
                  // Lógica para definir o nome (Cache ou User)
                  let storedId = await AsyncStorage.getItem('appDeviceId');
                  if (!storedId) {
                      const base = (user?.name && user.name.trim().length > 0) 
                          ? user.name.trim() 
                          : (user?.email?.split('@')[0] || 'App_Usuario');
                      
                      const firstName = base.split(/\s+/)[0]
                          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                          .replace(/[^A-Za-z0-9_]/g, '');
                      
                      storedId = `App_${firstName}`;
                      await AsyncStorage.setItem('appDeviceId', storedId);
                  }
                  
                  myAppId.current = storedId;

                  console.log(`🆔 Identificando como: ${storedId}`);
                  const idMsg = JSON.stringify({
                      type: 'DEVICE_STATUS',
                      deviceId: storedId,
                      payload: {
                          status: 'online',
                          state: 'ATIVO',
                          platform: 'mobile',
                          timestamp: Date.now()
                      }
                  });
                  ws.current.ws.send(idMsg);
                  
              } catch (e) {
                  console.error("Erro na identificação:", e);
              }
          }
      };
      
      enviarIdentidade();

      // --- PASSO B: SOLICITAR DADOS (O QUE ESTÁ ACONTECENDO?) ---
      // Pequeno delay para garantir que o servidor processou a identidade antes de responder
      setTimeout(() => {
          requestSystemBroadcast();
      }, 300);
    }
  }, [connectionStatus, requestSystemBroadcast, user]); // Adicionado 'user' nas dependências

  const value: AlertsContextType = {
    connectionStatus,
    sensorState,
    fallState,
    activeAlert,
    dismissActiveAlert,
    devicesById,
    deviceTypes,
    getDeviceTypesList,
    updateDeviceType,
    getDevicesByType,
    getNewDevices,
    acknowledgeAlert,
    wristbandPanicActive,
    requestSystemBroadcast,
    addDevice,
    removeDevice,
    enviarComando,
    alertsQueue,
  };

  return (
    <AlertsContext.Provider value={value}>
      {children}
    </AlertsContext.Provider>
  );
};

const styles = StyleSheet.create({
  alertOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  alertBox: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#374151',
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f9fafb',
    marginBottom: 6,
  },
  alertMessage: {
    fontSize: 14,
    color: '#e5e7eb',
    marginBottom: 12,
  },
  alertTimestamp: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 12,
  },
  alertButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  alertButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});

