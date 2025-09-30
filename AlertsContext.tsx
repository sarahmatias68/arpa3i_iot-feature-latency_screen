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

// --- TIPOS CORRIGIDOS ---
interface FallDetails {
  status: "Queda Detectada";
  comodo: string;
  dispositivo: string;
}
type FallState = "Desconectado" | "Nenhuma Queda" | FallDetails;

// O resto dos tipos...
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
  const ws = useRef<WsConnection | null>(null);

  const connect = useCallback(() => {
    handleStateChange("connectionStatus", "Conectando...");

    const handlers = {
      onOpen: () => {
        handleStateChange("connectionStatus", "Conectado");
        handleStateChange("sensorState", "Ambiente Seguro");
        handleStateChange("buttonState", "Conectado");
        handleStateChange("fallState", "Nenhuma Queda");
      },

      // LÓGICA DE MENSAGEM CORRIGIDA
      onMessage: (event: { data: string }) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "ping") return;

          if (data.type === "new_alert" || data.type === "alert_acknowledged") {
            fetchAlerts();
          }

          if (data.type === "sensor" && data.tipo) {
            handleStateChange("sensorState", data.tipo);
          } else if (data.type === "botao" && data.status) {
            handleStateChange("buttonState", data.status);
          
          // CORREÇÃO PRINCIPAL: Ouvindo "alerta_queda" e tratando os dados
          } else if (data.type === "alerta_queda") {
            const fallDetails: FallDetails = {
              status: "Queda Detectada",
              comodo: data.comodo,
              dispositivo: data.dispositivo,
            };

            handleStateChange("fallState", fallDetails);

            setActiveAlert({
              title: "⚠️ ALERTA DE QUEDA DETECTADA!",
              message: `Evento no cômodo '${data.comodo}' detectado pelo dispositivo '${data.dispositivo}'.`,
            });
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
    handleStateChange("fallState", "Nenhuma Queda");
  };

  const fetchAlerts = useCallback(async () => {
    // ... seu código
  }, []);

  const acknowledgeAlertInList = async (id: string) => {
    // ... seu código
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
  };

  return (
    <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>
  );
};