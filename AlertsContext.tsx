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
import messaging from '@react-native-firebase/messaging';
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
  lastAlertType?: "PANIC" | "FALL" | "GAS_LEAK" | "SMOKE";
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
  type: "PANIC" | "FALL" | "GAS_LEAK" | "SMOKE";
  timestamp?: number; // epoch ms
}

interface AlertItem {
  id: string; // server alert id ou hash local
  deviceId: string;
  type: "PANIC" | "FALL" | "GAS_LEAK" | "SMOKE";
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
  acknowledgeAlert: (deviceId: string, alertType: "PANIC" | "FALL" | "GAS_LEAK" | "SMOKE") => void;
  wristbandPanicActive: boolean;
  requestSystemBroadcast: () => void;
  addDevice: (deviceId: string) => Promise<void>;
  removeDevice: (deviceId: string) => Promise<void>;
  enviarComando: (targetId: string, action: string) => void;
  triggerVirtualPanic: () => void;
  deviceTypes: Record<DeviceType, DeviceTypeConfig>; // Acesso rápido (Objeto)
  getDeviceTypesList: () => ({ id: DeviceType } & DeviceTypeConfig)[]; // Para menus (Array)
  // fila
  alertsQueue: AlertItem[];
}

const WEBSOCKET_URL = "wss://app.arpa3i.me/ws";
const SERVER_HTTP_BASE = "https://painel.arpa3i.me";
const DEVICE_TIMEOUT_MS = 30 * 1000;
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
    pulseira: { name: "Pulseira de Pânico", icon: "accessibility-outline", color: "#facc15", capability: 'sensor' },
    barreira: { name: "Barreira IV", icon: "scan-outline", color: "#f87171", capability: 'sensor' },
    microondas: { name: "Radar Micro-ondas", icon: "radio-outline", color: "#60a5fa", capability: 'sensor' },
    detector: { name: "Detector de Queda", icon: "body-outline", color: "#c084fc", capability: 'sensor' },
    gas_fumaca: { name: "Sensor Gás/Fumaça", icon: "flame-outline", color: "#fb923c", capability: 'sensor' },

    // ATUADORES (Controle)
    automacao: { name: "Automação Genérica", icon: "power-outline", color: "#8b5cf6", capability: 'atuador' },
    portao: { name: "Portão Eletrônico", icon: "car-sport-outline", color: "#10b981", capability: 'atuador' },

    // SISTEMA
    servidor: { name: "Servidor Central", icon: "server-outline", color: "#475569", capability: 'sistema' },
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
      },

      onMessage: (event: { data: string }) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "ping") return;

          // Extração unificada do deviceId
          const deviceId = data.dispositivo || data.deviceId || "desconhecido";
          if (deviceId === "desconhecido" && data.type !== "sensor") {
            return;
          }

          if (data.type === "sensor") {
            setSensorState(data.tipo);
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

          if (data.type === "ALERTA" || data.type === "ALERT") {
            const subType = data.sub_type;
            const userRole = user?.role || "pending";

            const isPanic = subType === "PANIC";
            const isFall = subType === "FALL";
            const isEnvAlert = subType === "GAS_LEAK" || subType === "SMOKE";
            const isTech = subType === "SENSOR_FAIL";

            const hasPermission = (userRole === "admin") ||
              (userRole === "caregiver" && !isTech) ||
              (userRole === "elderly" && isEnvAlert);

            if (!hasPermission) return;

            if (isPanic) {
              setDevicesById(prev => ({
                ...prev,
                [deviceId]: {
                  ...(prev[deviceId] || { deviceId }),
                  lastAlertType: "PANIC",
                  connected: true,
                  status: "online",
                  lastSeen: Date.now(),
                  lastAlertAt: Date.now(),
                  ip: data.ip || "desconhecido",
                }
              }));
              AsyncStorage.setItem(`deviceAlert_${deviceId}`, JSON.stringify({ alertType: "PANIC", timestamp: Date.now() }));
              setAlertsQueue(prev => ([...prev, {
                id: `local-${deviceId}-PANIC-${Date.now()}`,
                deviceId, type: 'PANIC', message: `Pânico acionado: ${deviceId}`, timestamp: Date.now(),
              }]));
              setWristbandPanicActive(true);
            }
            else if (isFall) {
              const local = data.detalhes?.local || "Ambiente";
              setDevicesById(prev => ({
                ...prev,
                [deviceId]: {
                  ...(prev[deviceId] || { deviceId }),
                  lastAlertType: "FALL",
                  connected: true,
                  status: "online",
                  lastSeen: Date.now(),
                  lastAlertAt: Date.now(),
                }
              }));
              AsyncStorage.setItem(`deviceAlert_${deviceId}`, JSON.stringify({ alertType: "FALL", timestamp: Date.now() }));
              setFallState({ status: "Queda Detectada", comodo: local, dispositivo: deviceId });
              setAlertsQueue(prev => ([...prev, {
                id: `local-${deviceId}-FALL-${Date.now()}`,
                deviceId, type: 'FALL', message: `Queda detectada em '${local}'`, timestamp: Date.now(),
              }]));
            }
            else if (isEnvAlert) {
              const local = data.detalhes?.local || "Ambiente";
              const type = subType === "GAS_LEAK" ? 'GAS_LEAK' : 'SMOKE';
              setAlertsQueue(prev => ([...prev, {
                id: `env-${deviceId}-${Date.now()}`,
                deviceId, type, message: `ALERTA CRÍTICO: Detectado ${subType} em '${local}'.`, timestamp: Date.now(),
              }]));
            }
          }
          else if (data.type === "STATE") {
            const newState = data.payload?.state;
            if (newState) {
              setDevicesById(prev => ({
                ...prev,
                [deviceId]: {
                  ...(prev[deviceId] || { deviceId }),
                  gateState: newState,
                  status: "online",
                  connected: true,
                  lastSeen: Date.now(),
                }
              }));
            }
          }
          else if (data.type === "DEVICE_STATUS") {
            if (!data.payload) return;
            const payload = data.payload;
            const isOnline = payload.status === "online";
            setDevicesById(prev => {
              const prevDevice = prev[deviceId];
              const autoType = SERVER_DEVICE_PATTERN.test(deviceId) ? 'servidor' : prevDevice?.deviceType;
              return {
                ...prev,
                [deviceId]: {
                  ...(prevDevice || { deviceId }),
                  deviceType: autoType,
                  status: isOnline ? "online" : "offline",
                  connected: isOnline,
                  lastSeen: isOnline ? Date.now() : (prevDevice?.lastSeen || 0),
                  gateState: payload.state || prevDevice?.gateState,
                  uptimeSec: payload.uptimeSec,
                  reconnects: payload.reconnects,
                  batteryMv: payload.batteryMv,
                  rssiDbm: payload.rssiDbm,
                  ip: payload.ip,
                  heapB: payload.heapB,
                  tempCpuC: payload.tempCpu,
                }
              };
            });
          }
          else if (data.type === "ALERT_ACK_CONFIRMED") {
            const targetId = data.targetId;
            const aType = data.alertType;
            setDevicesById(prev => ({
              ...prev,
              [targetId]: { ...prev[targetId], lastAlertType: undefined }
            }));
            if (aType === 'PANIC') setWristbandPanicActive(false);
            if (aType === 'FALL') setFallState("Ativo");
            setAlertsQueue(prev => prev.filter(a => a.deviceId !== targetId));
          }
          else if (data.type === "SYSTEM_BROADCAST") {
            const broadcastData = data.data;
            if (broadcastData?.broadcast_type === "DEVICE_STATUS") {
              const statusData = broadcastData.status_data;
              setDevicesById(prev => {
                const currentDevice = prev[deviceId] || { deviceId };
                return {
                  ...prev,
                  [deviceId]: {
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
                  }
                };
              });
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
  }, [markAllDevicesAsOffline, user]);

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

      const titles: Record<string, string> = {
        PANIC: 'Alerta de Pânico!',
        FALL: 'Alerta de Queda!',
        GAS_LEAK: 'Vazamento de Gás!',
        SMOKE: 'Detector de Fumaça!'
      };

      setActiveAlert({
        title: titles[first.type] || 'Alerta do Sistema',
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
        // ------------------------------------------------------------------
        // [CORREÇÃO V52.10] Carregamento Prioritário de Cache Visual
        // ------------------------------------------------------------------

        // 1. Recupera o último retrato visual completo (incluindo gateState)
        const cachedJson = await AsyncStorage.getItem('lastKnownDevices');
        let initialDevices: Record<string, DeviceStatus> = {};

        if (cachedJson) {
          initialDevices = JSON.parse(cachedJson);
          // Marca tudo como offline visualmente para segurança, mas MANTÉM o gateState
          Object.keys(initialDevices).forEach(key => {
            initialDevices[key].connected = false;
            initialDevices[key].status = 'offline';
            // Não limpamos gateState, batteryMv, etc. Isso evita a "piscada".
          });
        }

        // 2. Busca definições atualizadas do servidor (Tipos)
        // Isso garante que se você mudou um ícone ou tipo, o app saiba.
        try {
          const res = await fetch(`${SERVER_HTTP_BASE}/devices`);
          if (res.ok) {
            const items: Array<{ deviceId: string; deviceType: DeviceType }> = await res.json();
            items.forEach(it => {
              // Se o dispositivo já existe no cache, atualiza só o tipo
              if (initialDevices[it.deviceId]) {
                initialDevices[it.deviceId].deviceType = it.deviceType;
              } else {
                // Se é novo (não estava no cache), cria entrada básica
                initialDevices[it.deviceId] = {
                  deviceId: it.deviceId,
                  status: 'offline',
                  connected: false,
                  lastSeen: 0,
                  deviceType: it.deviceType
                };
              }
            });
          }
        } catch (e) {
          console.warn("Modo Offline: Usando definições locais de dispositivos.");
        }

        // 3. Aplica o estado inicial IMEDIATAMENTE
        // O App vai renderizar "Portão Fechado" (cinza/offline) instantaneamente, sem passar por "Sincronizando".
        setDevicesById(initialDevices);

        // 4. Reidratação de Alertas Pendentes (Lógica mantida)
        const firstWithAlert = Object.values(initialDevices).find(d => d.lastAlertType);
        if (firstWithAlert) {
          const aType = firstWithAlert.lastAlertType;
          const deviceId = firstWithAlert.deviceId;

          if (aType === "PANIC") {
            setAlertsQueue(prev => ([...prev, {
              id: `cache-${Date.now()}`, deviceId,
              type: 'PANIC', message: 'Alerta de Pânico restaurado.', timestamp: Date.now()
            }]));
            setWristbandPanicActive(true);
          }
          else if (aType === "FALL") {
            setFallState("Ativo");
            setAlertsQueue(prev => ([...prev, {
              id: `cache-${Date.now()}`, deviceId,
              type: 'FALL', message: 'Alerta de Queda restaurado.', timestamp: Date.now()
            }]));
          }
          else if (aType === "GAS_LEAK" || aType === "SMOKE") {
            setAlertsQueue(prev => ([...prev, {
              id: `cache-${Date.now()}`, deviceId,
              type: aType, message: `Alerta de ${aType} restaurado.`, timestamp: Date.now()
            }]));
          }
        }

      } catch (error) {
        console.error("Erro fatal ao carregar dados:", error);
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

  const acknowledgeAlert = (deviceId: string, alertType: "PANIC" | "FALL" | "GAS_LEAK" | "SMOKE") => {
    if (ws.current?.ws?.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "ALERT_ACK",
        targetId: deviceId,
        alertType: alertType
      });
      ws.current.ws.send(message);
    }

    // Persistência e limpeza local seguem o novo protocolo
    AsyncStorage.removeItem(`deviceAlert_${deviceId}`).catch(e => console.error(e));
    if (alertType === 'PANIC') setWristbandPanicActive(false);
    if (alertType === 'FALL') setFallState("Ativo");

    setDevicesById(prev => ({
      ...prev,
      [deviceId]: { ...prev[deviceId], lastAlertType: undefined }
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
  // --- [REFATORAÇÃO V2.1] Função Mestre de Identificação e Refresh ---
  const requestSystemBroadcast = useCallback(async () => {
    try {
      if (ws.current?.ws?.readyState === WebSocket.OPEN) {

        // 1. Resolução de Identidade (Lógica migrada de enviarIdentidade)
        let finalId = myAppId.current;

        if (!finalId || finalId === "App_Desconhecido") {
          try {
            const stored = await AsyncStorage.getItem('appDeviceId');
            if (stored) {
              finalId = stored;
            } else {
              // Gera ID baseado no usuário (Sanitização)
              const base = (user?.name && user.name.trim().length > 0)
                ? user.name.trim()
                : (user?.email?.split('@')[0] || 'App_Usuario');
              const firstName = base.split(/\s+/)[0]
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^A-Za-z0-9_]/g, '');

              finalId = `App_${firstName}`;
              await AsyncStorage.setItem('appDeviceId', finalId);
            }
            myAppId.current = finalId;
          } catch (e) {
            console.error("Erro ao resolver identidade:", e);
            finalId = `App_${user?.name || 'Generic'}`;
          }
        }

        console.log(`🔄 [Sync] Enviando DEVICE_STATUS como: ${finalId}`);

        // --- [ALTERAÇÃO: Inclusão do FCM Token no Handshake de Identidade] ---
        let fcmToken = null;
        try {
          // Obtém o token de registro atualizado para o Cloud Messaging
          fcmToken = await messaging().getToken();
        } catch (e) {
          console.error("⚠️ [Push] Falha ao capturar Token para o dispositivo:", e);
        }

        const message = JSON.stringify({
          type: "DEVICE_STATUS",
          deviceId: finalId,
          payload: {
            status: "online",
            state: "ATIVO",
            platform: "mobile",
            action: "FORCE_REFRESH",
            fcmToken: fcmToken, // Anexa o endereço de entrega para notificações push
            role: user?.role || "unknown",
            timestamp: Date.now()
          }
        });
        ws.current.ws.send(message);

      } else {
        console.log("WebSocket desconectado. Aguardando reconexão...");
      }
    } catch (e) {
      console.error("Falha crítica no handshake:", e);
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
        type: "COMMAND",
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

  // --- [FIX V51.1] Pânico Virtual com Identidade Robusta (Async) ---
  const triggerVirtualPanic = useCallback(async () => {
    // 1. Programação Defensiva: Verifica conexão
    if (ws.current?.ws && connectionStatus === "Conectado") {

      // 2. Resolução de Identidade "Just-in-Time"
      // Se a identidade ainda não carregou (App_Desconhecido), forçamos a geração agora.
      let finalId = myAppId.current;

      if (!finalId || finalId === "App_Desconhecido") {
        try {
          // Tenta recuperar do armazenamento local primeiro
          const stored = await AsyncStorage.getItem('appDeviceId');
          if (stored) {
            finalId = stored;
          } else {
            // Se não existir, gera ID baseado no usuário logado (Emergency Fallback)
            const baseName = user?.name ? user.name.split(' ')[0] : "Usuario";
            // Remove caracteres especiais para evitar quebra de protocolo
            const safeName = baseName.replace(/[^a-zA-Z0-9]/g, '');
            finalId = `App_${safeName}`;

            // Salva para uso futuro
            await AsyncStorage.setItem('appDeviceId', finalId);
          }
          // Atualiza a referência global
          myAppId.current = finalId;
        } catch (e) {
          console.error("Erro crítico ao gerar ID de pânico:", e);
          finalId = "App_Emergencia"; // Último recurso
        }
      }

      // 3. Construção do Pacote V51 (ALERT / PANIC)
      const payload = {
        type: "ALERT",
        sub_type: "PANIC",
        deviceId: finalId,
        detalhes: {
          local: "App Mobile (Virtual)",
          timestamp: Date.now()
        }
      };

      console.warn(`🚨 [PÂNICO VIRTUAL] Disparando alerta de: ${finalId}`);
      ws.current.ws.send(JSON.stringify(payload));

      // 4. Feedback Otimista (UX Imediata)
      setWristbandPanicActive(true);

      setAlertsQueue(prev => ([
        ...prev,
        {
          id: `virtual-${finalId}-PANIC-${Date.now()}`,
          deviceId: finalId,
          type: 'PANIC',
          message: `Botão de pânico acionado manualmente pelo App (${finalId}).`,
          timestamp: Date.now(),
        }
      ]));

    } else {
      console.error("❌ Erro: Não é possível enviar pânico (Sem Conexão).");
    }
  }, [connectionStatus, user]); // Adicionado 'user' como dependência vital 

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
      requestSystemBroadcast();
    }
  }, [connectionStatus, requestSystemBroadcast, user]); // Adicionado 'user' nas dependências

  useEffect(() => {
    if (Object.keys(devicesById).length > 0) {
      const json = JSON.stringify(devicesById);
      AsyncStorage.setItem('lastKnownDevices', json).catch(e => console.error(e));
    }
  }, [devicesById]);

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
    triggerVirtualPanic,
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

