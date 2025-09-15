import { View, Text, StyleSheet } from 'react-native';

const ConnectionStatusBanner = ({ status }) => {
  if (status === 'Conectado') {
    return null; // Don't show anything if connected
  }

  const getBannerStyle = () => {
    switch (status) {
      case 'Conectando...':
        return styles.connecting;
      case 'Desconectado':
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
    width: '100%',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    zIndex: 1000,
  },
  connecting: {
    backgroundColor: '#facc15', // Yellow
  },
  disconnected: {
    backgroundColor: '#ef4444', // Red
  },
  text: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default ConnectionStatusBanner;
