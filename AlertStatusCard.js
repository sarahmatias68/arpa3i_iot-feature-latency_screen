import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function AlertStatusCard({ activeAlert, onDismiss }) {
  if (!activeAlert) return null;

  const getAlertIcon = (type) => {
    switch (type) {
      case 'QUEDA': return '⚠️';
      case 'PANICO': return '🚨';
      case 'BATERIA_FRACA': return '🔋';
      case 'FUMACA_SIMULADA': return '💨';
      case 'GAS_SIMULADO': return '⛽';
      default: return '⚠️';
    }
  };

  const getAlertColor = (type) => {
    switch (type) {
      case 'QUEDA': return '#ef4444';
      case 'PANICO': return '#dc2626';
      case 'BATERIA_FRACA': return '#f59e0b';
      case 'FUMACA_SIMULADA': return '#f97316';
      case 'GAS_SIMULADO': return '#eab308';
      default: return '#ef4444';
    }
  };

  return (
    <View style={[styles.alertCard, { borderColor: getAlertColor(activeAlert.type) }]}>
      <View style={styles.alertHeader}>
        <Text style={styles.alertIcon}>{getAlertIcon(activeAlert.type)}</Text>
        <Text style={[styles.alertTitle, { color: getAlertColor(activeAlert.type) }]}>
          {activeAlert.title}
        </Text>
      </View>
      <Text style={styles.alertMessage}>{activeAlert.message}</Text>
      <View style={styles.alertActions}>
        <Text style={styles.alertTime}>
          {new Date().toLocaleTimeString('pt-BR')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  alertCard: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 20,
    marginBottom: 15,
    borderWidth: 2,
    borderLeftWidth: 6,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  alertIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  alertTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
  },
  alertMessage: {
    fontSize: 14,
    color: '#d1d5db',
    lineHeight: 20,
    marginBottom: 10,
  },
  alertActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  alertTime: {
    fontSize: 12,
    color: '#9ca3af',
  },
});
