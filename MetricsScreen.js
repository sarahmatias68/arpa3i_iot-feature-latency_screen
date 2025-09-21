import { View, Text, StyleSheet, ScrollView } from 'react-native';
import useWebSocket from './useWebSocketSensor';

const WEBSOCKET_URL = 'ws://192.168.2.115:86/ws';

export default function MetricsScreen() {
  const { metricsState} = useWebSocket(WEBSOCKET_URL);
  const metrics = metricsState;

  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };


  // Se loading for false, renderiza os cards se os dados existirem.
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Relatório de Desempenho do Servidor</Text>

      {/* RAM Card */}
    
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Memória RAM</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Livre:</Text>
            <Text style={styles.metricValue}>{formatBytes(metrics.ram.free)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Total:</Text>
            <Text style={styles.metricValue}>{formatBytes(metrics.ram.total)}</Text>
          </View>
          <View style={styles.progressBarBackground}>
            <View style={[styles.progressBarFill, { width: `${(1 - metrics.ram.free / metrics.ram.total) * 100}%` }]} />
          </View>
        </View>


      {/* SD Card */}
    
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Armazenamento (SD)</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Usado:</Text>
            <Text style={styles.metricValue}>{formatBytes(metrics.sd.used)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Total:</Text>
            <Text style={styles.metricValue}>{formatBytes(metrics.sd.total)}</Text>
          </View>
          <View style={styles.progressBarBackground}>
            <View style={[styles.progressBarFill, { width: `${(metrics.sd.used / metrics.sd.total) * 100}%`, backgroundColor: '#f59e0b' }]} />
          </View>
        </View>
  

      {/* Latency Card */}
  
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Latência da Rede (WebSocket)</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Média:</Text>
            <Text style={styles.metricValue}>{metrics.latency.avg} ms</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Mínima:</Text>
            <Text style={styles.metricValue}>{metrics.latency.min} ms</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Máxima:</Text>
            <Text style={styles.metricValue}>{metrics.latency.max} ms</Text>
          </View>
        </View>
  
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
    padding: 20,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f9fafb',
    textAlign: 'center',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f9fafb',
    marginBottom: 15,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  metricLabel: {
    fontSize: 16,
    color: '#d1d5db',
  },
  metricValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f9fafb',
  },
  progressBarBackground: {
    height: 10,
    backgroundColor: '#374151',
    borderRadius: 5,
    marginTop: 10,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 5,
  },
});
