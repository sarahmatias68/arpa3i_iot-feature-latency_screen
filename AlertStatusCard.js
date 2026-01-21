import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAlerts } from './AlertsContext'; // Certifique-se que o caminho está correto

export default function AlertStatusCard({ activeAlert }) {
  const { acknowledgeAlert } = useAlerts();

  if (!activeAlert) return null;

  // Mapeamento de Ícones para JavaScript puro
  const getAlertIcon = (type) => {
    switch (type) {
      case 'QUEDA': return 'warning-outline';
      case 'POSSIVEL_QUEDA': return 'hand-right-outline';
      case 'PANICO': return 'alert-circle-outline';
      case 'GAS': return 'flame-outline';
      case 'FUMACA': return 'cloud-outline';
      case 'FALHA_SENSOR': return 'construct-outline';
      case 'PORTAO_ACIONADO': return 'exit-outline';
      default: return 'notifications-outline';
    }
  };

  // Mapeamento de Cores
  const getAlertColor = (type) => {
    switch (type) {
      case 'QUEDA':
      case 'PANICO': 
        return '#ef4444'; 
      case 'GAS':
      case 'FUMACA': 
        return '#f97316'; 
      case 'POSSIVEL_QUEDA':
      case 'FALHA_SENSOR': 
        return '#eab308'; 
      default: return '#6b7280';
    }
  };

  return (
    <View style={[styles.alertCard, { borderColor: getAlertColor(activeAlert.type) }]}>
      <View style={styles.alertHeader}>
        <Ionicons
          name={getAlertIcon(activeAlert.type)}
          size={28}
          color={getAlertColor(activeAlert.type)}
          style={styles.alertIcon}
        />
        <Text style={[styles.alertTitle, { color: getAlertColor(activeAlert.type) }]}>
          {activeAlert.title || activeAlert.type}
        </Text>
      </View>
      
      <Text style={styles.alertMessage}>{activeAlert.message}</Text>
      
      <View style={styles.alertActions}>
        <Text style={styles.alertTime}>
          {activeAlert.timestamp 
            ? new Date(activeAlert.timestamp).toLocaleTimeString('pt-BR') 
            : new Date().toLocaleTimeString('pt-BR')}
        </Text>

        <TouchableOpacity 
          style={[styles.ackButton, { backgroundColor: getAlertColor(activeAlert.type) }]}
          onPress={() => acknowledgeAlert(activeAlert.id, activeAlert.deviceId, activeAlert.type)}
        >
          <Text style={styles.ackButtonText}>ESTOU CIENTE</Text>
        </TouchableOpacity>
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
    borderLeftWidth: 8,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  alertIcon: {
    marginRight: 10,
  },
  alertTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
  },
  alertMessage: {
    fontSize: 15,
    color: '#f3f4f6',
    lineHeight: 22,
    marginBottom: 15,
  },
  alertActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#374151',
    paddingTop: 12,
  },
  alertTime: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '600',
  },
  ackButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  ackButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
});