import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAlerts } from './AlertsContext';
import DeviceTypeSelector from './DeviceTypeSelector';
import { getTheme, typography } from './theme';

export default function CategoryDevicesScreen({ route, navigation, themeName = 'dark' }) {
  const { categoryTitle, categoryIcon, categoryKey, focusDeviceId } = route.params || {};
  
  const {
    deviceTypes,
    updateDeviceType,
    acknowledgeAlert,
    sensorState,
    getDevicesByType,
  } = useAlerts();

  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Busca os dispositivos filtrados pela categoria selecionada
  const categoryDevices = useMemo(() => {
    if (categoryKey === 'sensores') {
      return getDevicesByType('gas_fumaca').filter(d => d.deviceId !== 'SENSOR_GAS_FUMACA');
    } else if (categoryKey === 'pulseira') {
      return getDevicesByType('pulseira');
    } else if (categoryKey === 'detector') {
      return [
        ...getDevicesByType('barreira'), 
        ...getDevicesByType('microondas'), 
        ...getDevicesByType('detector')
      ];
    }
    return [];
  }, [categoryKey, getDevicesByType]);

  // Lógica de Scroll para foco (Notificações)
  const scrollRef = useRef(null);
  useEffect(() => {
    if (!focusDeviceId || !scrollRef.current) return;
    const idx = categoryDevices.findIndex(d => d.deviceId === focusDeviceId);
    if (idx >= 0) {
      scrollRef.current.scrollTo({ y: idx * 160, animated: true });
    }
  }, [focusDeviceId, categoryDevices]);

  const [typeSelectorVisible, setTypeSelectorVisible] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);

  // --- HELPERS DE INTERFACE ---
  
  const getStatusInfo = (device) => {
    if (device.lastAlertType) {
      const isCritical = ['PANICO', 'QUEDA', 'GAS', 'FUMACA'].includes(device.lastAlertType);
      return {
        text: `⚠️ ${device.lastAlertType}`,
        color: isCritical ? theme.colors.danger : theme.colors.warning,
        active: true
      };
    }
    return {
      text: device.connected ? 'ONLINE' : 'OFFLINE',
      color: device.connected ? theme.colors.success : theme.colors.muted,
      active: false
    };
  };

  const renderDeviceCard = (device) => {
    const status = getStatusInfo(device);
    const typeConfig = deviceTypes.find(t => t.id === device.deviceType) || { name: "Sem tipo", color: theme.colors.muted };
    
    // Prioriza tempCpu (v48) mas mantém tempCpuC como fallback
    const cpuTemp = device.tempCpu ?? device.tempCpuC;

    return (
      <TouchableOpacity 
        key={device.deviceId} 
        style={[
          styles.deviceCard, 
          status.active && (device.lastAlertType === 'PANICO' ? styles.cardPanicActive : styles.cardFallActive)
        ]}
        // No v48, passamos "app_manual" como ID se clicado no card, o servidor entenderá o contexto
        onPress={status.active ? () => acknowledgeAlert("app_manual", device.deviceId, device.lastAlertType) : null}
        activeOpacity={0.8}
      >
        <View style={styles.deviceHeader}>
          <Ionicons 
            name={typeConfig.icon || 'radio-outline'} 
            size={24} 
            color={status.active ? '#fff' : theme.colors.primary} 
          />
          <Text style={styles.deviceTitle}>{device.deviceId}</Text>
          <View style={[styles.statusBadge, { backgroundColor: status.color }]}>
             <Text style={styles.statusBadgeText}>{status.text}</Text>
          </View>
        </View>

        <View style={styles.mainContent}>
          <View style={styles.infoColumn}>
            {device.connected ? (
              <View style={styles.metricsGrid}>
                {cpuTemp && <Text style={styles.metricText}>🌡️ {cpuTemp}°C</Text>}
                {device.rssiDbm && <Text style={styles.metricText}>📶 {device.rssiDbm} dBm</Text>}
                {device.batteryMv && <Text style={styles.metricText}>🔋 {device.batteryMv}mV</Text>}
                {device.ip && <Text style={styles.metricSmallText}>IP: {device.ip}</Text>}
              </View>
            ) : (
              <Text style={styles.offlineText}>Dispositivo fora de alcance</Text>
            )}
          </View>

          <View style={styles.actionsColumn}>
             <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: typeConfig.color }]}
                onPress={() => { setSelectedDeviceId(device.deviceId); setTypeSelectorVisible(true); }}
             >
                <Text style={styles.actionButtonText}>Tipo</Text>
             </TouchableOpacity>
             
             <TouchableOpacity 
                style={styles.actionButtonBorder}
                onPress={() => navigation.navigate('DeviceEvents', { deviceId: device.deviceId })}
             >
                <Text style={styles.actionButtonTextBorder}>Logs</Text>
             </TouchableOpacity>
          </View>
        </View>

        {status.active && (
          <View style={styles.ackFooter}>
             <Text style={styles.ackHint}>Toque no card para confirmar ciência</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Ionicons name={categoryIcon} size={50} color={theme.colors.primary} />
          <Text style={styles.headerTitle}>{categoryTitle}</Text>
          <Text style={styles.headerSubtitle}>{categoryDevices.length} sensores ativos</Text>
        </View>

        {categoryDevices.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={40} color={theme.colors.muted} />
            <Text style={styles.emptyStateText}>Nenhum dispositivo encontrado</Text>
          </View>
        ) : (
          categoryDevices.map(renderDeviceCard)
        )}
      </ScrollView>

      <DeviceTypeSelector
        visible={typeSelectorVisible}
        onClose={() => setTypeSelectorVisible(false)}
        onSelectType={(type) => {
          updateDeviceType(selectedDeviceId, type);
          setTypeSelectorVisible(false);
        }}
        deviceTypes={deviceTypes}
      />
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scrollContent: { padding: 20 },
  header: { alignItems: 'center', marginBottom: 30 },
  headerTitle: { ...typography.h1, color: theme.colors.text, marginTop: 10 },
  headerSubtitle: { ...typography.small, color: theme.colors.muted },
  deviceCard: {
    backgroundColor: theme.colors.card,
    borderRadius: 15,
    padding: 16,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  deviceHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  deviceTitle: { ...typography.h3, color: theme.colors.text, marginLeft: 10, flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  mainContent: { flexDirection: 'row', justifyContent: 'space-between' },
  infoColumn: { flex: 1 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricText: { fontSize: 12, color: theme.colors.text, fontWeight: '600' },
  metricSmallText: { fontSize: 10, color: theme.colors.muted, width: '100%' },
  actionsColumn: { gap: 8, marginLeft: 15 },
  actionButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  actionButtonText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  actionButtonBorder: { borderWidth: 1, borderColor: theme.colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  actionButtonTextBorder: { color: theme.colors.primary, fontSize: 11, fontWeight: 'bold' },
  offlineText: { color: theme.colors.muted, fontSize: 12, fontStyle: 'italic' },
  cardPanicActive: { borderColor: theme.colors.danger, borderWidth: 2, backgroundColor: '#451a1a' },
  cardFallActive: { borderColor: theme.colors.warning, borderWidth: 2, backgroundColor: '#45301a' },
  ackFooter: { marginTop: 15, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 10 },
  ackHint: { fontSize: 10, color: '#fff', textAlign: 'center', opacity: 0.8 },
  emptyState: { marginTop: 50, alignItems: 'center' },
  emptyStateText: { color: theme.colors.muted, marginTop: 10 }
});