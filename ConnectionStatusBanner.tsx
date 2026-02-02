import { View, Text, StyleSheet } from "react-native";

interface ConnectionStatusBannerProps {
  status: "Conectado" | "Conectando..." | "Desconectado" | "Erro" | "";
}

export const ConnectionStatusBanner = ({
  status,
}: ConnectionStatusBannerProps) => {
  // 1. SILENT MODE: Se estiver Conectado, Vazio ou Conectando, não mostra nada no topo
  if (status === "Conectado" || status === "" || status === "Conectando...") {
    return null; 
  }

  const getBannerStyle = () => {
    switch (status) {
      // O case "Conectando..." foi removido pois já retornamos null acima
      case "Desconectado":
        return styles.disconnected;
      default:
        return styles.disconnected;
    }
  };

  return (
    <View style={[styles.banner, getBannerStyle()]}>
      <Text style={styles.text}>{status}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    padding: 10,
    width: "100%",
    alignItems: "center",
    position: "absolute",
    top: 0,
    zIndex: 1000,
  },
  connecting: {
    backgroundColor: "#facc15", // Yellow (Não usado mais no banner)
  },
  disconnected: {
    backgroundColor: "#ef4444", // Red
  },
  text: {
    color: "#fff",
    fontWeight: "bold",
  },
});