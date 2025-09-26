import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
  MutableRefObject,
} from "react";
import { Alert } from "react-native";
import { WsConnection } from "./wsConnection";
import { User } from "./types/model";

// Tipos auxiliares
type ConnectionStatus =
  | "Desconectado"
  | "Conectando..."
  | "Conectado"
  | "Finalizando conexão..."
  | "Erro";

type SensorState = "Servidor Desconectado" | "" | string;

type ButtonState = "Desconectado" | "" | string;

type FallState = "Servidor Desconectado" | "" | string;

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

const WEBSOCKET_URL = "ws://092bcd581463.ngrok-free.app/ws";
const API_URL = "http://092bcd581463.ngrok-free.app";

// Corrige: Fornece tipo ao contexto
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
    fallState: "Servidor Desconectado",
  });

  const handleStateChange = (state: keyof typeof states, value: string) => {
    setStates((prev) => ({ ...prev, [state]: value }));
  };

  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);
  const [allAlerts, setAllAlerts] = useState<AlertItem[]>([]);

  // ws.current: WsConnection | null
  const ws = useRef<WsConnection | null>(null);

  // Função para conectar usando WsConnection com validações de status
  const connect = useCallback(() => {
    handleStateChange("connectionStatus", "Conectando...");

    // Handlers para o WsConnection
    const handlers = {
      onOpen: () => {
        handleStateChange("connectionStatus", "Conectado");
        handleStateChange("sensorState", "");
        handleStateChange("buttonState", "");
        handleStateChange("fallState", "");
      },
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
          } else if (data.type === "queda" && data.status) {
            handleStateChange("fallState", data.status);
          }
        } catch (error) {
          console.info(event.data);
          console.error("Erro ao processar mensagem:", error);
        }
      },
      onClose: () => {
        handleStateChange("connectionStatus", "Desconectado");
        handleStateChange("sensorState", "Servidor Desconectado");
        handleStateChange("buttonState", "Desconectado");
        handleStateChange("fallState", "Servidor Desconectado");
        // Reconexão é tratada internamente pelo WsConnection
      },
      onError: () => {
        handleStateChange("connectionStatus", "Erro");
        handleStateChange("sensorState", "Servidor Desconectado");
        handleStateChange("buttonState", "Desconectado");
        handleStateChange("fallState", "Servidor Desconectado");
        // O WsConnection já fecha o socket em caso de erro
      },
    };

    // Cria a conexão e armazena a instância
    const socket = new WsConnection(WEBSOCKET_URL, handlers);
    ws.current = socket;
  }, []);

  // Validação do status do WebSocket periodicamente
  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;
    if (ws.current && ws.current.ws) {
      interval = setInterval(() => {
        const readyState = ws.current!.ws.readyState;
        // 0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED
        if (readyState === 0) {
          handleStateChange("connectionStatus", "Conectando...");
        } else if (readyState === 1) {
          handleStateChange("connectionStatus", "Conectado");
        } else if (readyState === 2) {
          handleStateChange("connectionStatus", "Finalizando conexão...");
        } else if (readyState === 3) {
          handleStateChange("connectionStatus", "Desconectado");
        }
      }, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [ws.current]);

  useEffect(() => {
    console.info("User", user);

    if (user && !ws.current) {
      connect();
    }
    return () => {
      // Ao desmontar, não reconectar mais
      if (ws.current && ws.current.ws) {
        ws.current.ws.close();
      }
    };
  }, [user, connect]);

  // Efeito para gerenciar a exibição de alertas modais
  useEffect(() => {
    if (states.buttonState === "Apertado") {
      setActiveAlert({
        title: "Botão de Pânico Acionado",
        message:
          "O botão de pânico foi pressionado. Verifique a situação imediatamente.",
      });
    } else if (states.fallState === "Queda Detectada") {
      setActiveAlert({
        title: "Alerta de Queda",
        message: "Uma possível queda foi detectada.",
      });
    }
  }, [states.sensorState, states.buttonState, states.fallState]);

  const dismissActiveAlert = () => {
    setActiveAlert(null);
  };

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/alerts`);
      if (!response.ok) throw new Error("Falha na resposta do servidor.");
      const data = await response.json();
      setAllAlerts(data);
    } catch (error) {
      Alert.alert("Erro", "Não foi possível buscar os alertas.");
      setAllAlerts([]);
    }
  }, []);

  const acknowledgeAlertInList = async (id: string) => {
    if (!user) {
      Alert.alert(
        "Erro",
        "Você precisa estar logado para confirmar um alerta."
      );
      return;
    }
    try {
      const response = await fetch(`${API_URL}/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `id=${id}&user=${user.name}`,
      });
      const result = await response.json();
      if (result.status === "success") {
        Alert.alert("Sucesso", "Alerta confirmado.");
        // A atualização agora é tratada pelo WebSocket
      } else {
        throw new Error(result.message || "Falha ao confirmar.");
      }
    } catch (error: any) {
      Alert.alert("Erro", error.message);
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
  };

  return (
    <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>
  );
};
