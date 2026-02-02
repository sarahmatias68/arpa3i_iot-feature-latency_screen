import { View, Text, StyleSheet, StatusBar, TouchableOpacity, ScrollView } from 'react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
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
    getDeviceTypesList, // Adicionado para o Seletor funcionar
  } = useAlerts();

  // --- FASE 5: Adaptação para Receber Objeto Agrupado ---
  // Corrige a busca de dados para ser compatível com o novo Contexto
  const getCategoryDevices = () => {
    // 1. Busca o Mapa Completo (O Contexto agora retorna um Objeto)
    const allGroups = getDevicesByType(); 

    if (categoryKey === 'sensores') {
      // Busca na chave 'gas_fumaca' e filtra o sensor virtual
      return (allGroups['gas_fumaca'] || []).filter(d => d.deviceId !== 'SENSOR_GAS_FUMACA');
    
    } else if (categoryKey === 'pulseira') {
      // Busca direto na chave
      return allGroups['pulseira'] || [];
    
    } else if (categoryKey === 'detector') {
      // Junta as 3 listas (Barreira + Microondas + Detector)
      return [
        ...(allGroups['barreira'] || []),
        ...(allGroups['microondas'] || []),
        ...(allGroups['detector'] || [])
      ];
    
    } else if (categoryKey === 'automacao') {
      // O 'portao' já está incluso aqui dentro pelo Contexto
      return allGroups['automacao'] || [];
    
    } else if (categoryKey === 'server' || categoryTitle === 'Servidor') {
      // Caso especial do servidor
      return allGroups['servidor'] || [];
    }
    
    return [];
  };

  const devices = getCategoryDevices();

  const [selectorVisible, setSelectorVisible] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Rola até o dispositivo focado se houver
  const scrollViewRef = useRef(null);
  useEffect(() => {
    if (focusDeviceId && devices.length > 0) {
      setTimeout(() => {
        // Lógica simples de scroll (pode ser refinada)
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      }, 500);
    }
  }, [focusDeviceId, devices]);

  const handleUpdateType = async (newType) => {
    if (selectedDeviceId) {
      await updateDeviceType(selectedDeviceId, newType);
      setSelectorVisible(false);
      setSelectedDeviceId(null);
    }
  };

const renderDeviceItem = (device) => {
    // --- FUNÇÕES AUXILIARES ---
    const formatBytes = (bytes) => {
      if (!bytes) return '--';
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const getUpdatedAgo = (lastSeen) => {
      if (!lastSeen) return '--';
      const seconds = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000);
      if (seconds < 60) return `${seconds}s atrás`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)}m atrás`;
      return `${Math.floor(seconds / 3600)}h atrás`;
    };

    // --- CONFIGURAÇÃO VISUAL ---
    const deviceTypeConfig = deviceTypes[device.deviceType] || { 
      name: "Desconhecido", 
      icon: "help-circle-outline", 
      color: "#999" 
    };
    
    const isOnline = device.status === 'online';
    const isPanic = device.lastAlertType === 'PANICO';
    const isFall = device.lastAlertType === 'QUEDA';
    const isRecentAlert = device.lastAlertAt && (Date.now() - device.lastAlertAt < 300000);
    const highlight = isRecentAlert && (isPanic || isFall);

    // Formatação de Valores
    const battery = device.batteryMv ? `${(device.batteryMv / 1000).toFixed(1)}V` : '--';
    const signal = device.rssiDbm ? `${device.rssiDbm}dBm` : '--';
    const uptime = device.uptimeSec 
      ? `${Math.floor(device.uptimeSec / 3600)}h ${Math.floor((device.uptimeSec % 3600) / 60)}m` 
      : '--';

    // Helper para renderizar linha com ícone
    const InfoRow = ({ icon, label, value, color }) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <Ionicons name={icon} size={16} color={theme.colors.muted} style={{ marginRight: 6, width: 20 }} />
        <Text style={styles.deviceInfoText}>
          {label}: <Text style={{ color: color || theme.colors.text }}>{value}</Text>
        </Text>
      </View>
    );

    return (
      <View 
        key={device.deviceId} 
        style={[
          styles.deviceCard,
          highlight && (isPanic ? styles.cardPanicActive : styles.cardFallActive)
        ]}
      >
{/* Cabeçalho: Ícone + Nome (Esquerda) e Configurar (Direita) */}
        <View style={styles.deviceHeader}>
          {/* Lado Esquerdo: Ícone do Tipo + Textos */}
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
            <View style={[styles.iconContainer, { backgroundColor: deviceTypeConfig.color + '20' }]}>
              <Ionicons name={deviceTypeConfig.icon} size={24} color={deviceTypeConfig.color} />
            </View>
            <View>
              <Text style={styles.deviceId}>{device.deviceId}</Text>
              <Text style={[styles.deviceType, { color: deviceTypeConfig.color }]}>
                {deviceTypeConfig.name}
              </Text>
            </View>
          </View>

          {/* Lado Direito: Botão Configurar (Engrenagem Discreta) */}
          <TouchableOpacity 
            onPress={() => {
              setSelectedDeviceId(device.deviceId);
              setSelectorVisible(true);
            }}
            style={{ padding: 4 }} // Aumenta área de toque
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="settings-outline" size={22} color={theme.colors.muted} />
          </TouchableOpacity>
        </View>

        {/* Lista de Informações (Com Ícones e Ordem Corrigida) */}
        <View style={styles.deviceInfoBlock}>
          
          {/* 1. Status */}
          <InfoRow 
            icon={isOnline ? "ellipse" : "ellipse-outline"}
            label="Status" 
            value={isOnline ? 'Online' : 'Offline'} 
            color={isOnline ? '#10b981' : '#ef4444'}
          />

          {/* 2. Bateria (Movido para cá) */}
          {device.batteryMv !== null && (
             <InfoRow icon="battery-half" label="Bateria" value={battery} />
          )}

          {/* 3. Atividade */}
          <InfoRow icon="time-outline" label="Atividade" value={uptime} />

          {/* 4. Sinal */}
          <InfoRow icon="cellular-outline" label="Sinal" value={signal} />
          
          {/* 5. Temperatura CPU */}
          {device.tempCpuC && (
            <InfoRow icon="thermometer-outline" label="Temperatura CPU" value={`${device.tempCpuC}°C`} />
          )}

          {/* 6. Memória livre */}
          {device.heapB && (
            <InfoRow icon="hardware-chip-outline" label="Memória livre" value={formatBytes(device.heapB)} />
          )}

          {/* 7. Reconexões */}
          {device.reconnects !== undefined && (
            <InfoRow icon="refresh-outline" label="Reconexões" value={device.reconnects} />
          )}

          {/* 8. Atualizado há */}
          <InfoRow icon="sync-outline" label="Atualizado há" value={getUpdatedAgo(device.lastSeen)} />
          
          {/* 9. IP */}
          {device.ip && (
            <InfoRow icon="globe-outline" label="IP" value={device.ip} />
          )}

        </View>

        {/* Status Específico de Sensor */}
        {(categoryKey === 'sensores' || categoryKey === 'detector') && (
           <View style={styles.sensorStateContainer}>
             <Text style={styles.sensorStateLabel}>Estado Atual</Text>
             <Text style={styles.sensorStateText}>
               {sensorState === 'ALERTA' ? '⚠️ ALERTA DETECTADO' : 'Normal'}
             </Text>
           </View>
        )}

{/* Botões de Ação (Apenas aparece se tiver Alerta para Reconhecer) */}
        {highlight && (
          <View style={styles.actionsRow}>
             <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: theme.colors.primary + '20' }]}
                onPress={() => acknowledgeAlert(device.deviceId)}
             >
               <Ionicons name="checkmark-circle-outline" size={20} color={theme.colors.primary} />
               <Text style={[styles.actionButtonText, {color: theme.colors.primary}]}>Reconhecer Alerta</Text>
             </TouchableOpacity>
          </View>
        )}

        {highlight && (
          <Text style={styles.ackHint}>Toque em Reconhecer para parar o alarme</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={theme.name === 'light' ? "dark-content" : "light-content"} backgroundColor={theme.colors.background} />

      <ScrollView 
        ref={scrollViewRef}
        contentContainerStyle={styles.scrollContent}
      >
        {devices.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cloud-offline-outline" size={64} color={theme.colors.muted} />
            <Text style={styles.emptyText}>Nenhum dispositivo encontrado nesta categoria.</Text>
          </View>
        ) : (
          devices.map(renderDeviceItem)
        )}
      </ScrollView>

      {/* Seletor de Tipo (Modal) */}
      <DeviceTypeSelector
        visible={selectorVisible}
        onClose={() => setSelectorVisible(false)}
        onSelectType={handleUpdateType}   // Correção: onSelect -> onSelectType
        deviceTypes={getDeviceTypesList()} // Correção: items -> deviceTypes (e usa a lista com IDs)
        deviceId={selectedDeviceId}
      />
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingTop: 50, backgroundColor: theme.colors.card, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  backButton: { padding: 8 },
  headerTitleContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { ...typography.h3, color: theme.colors.text },
  scrollContent: { padding: 20 },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 100, gap: 20 },
  emptyText: { ...typography.body, color: theme.colors.muted, textAlign: 'center' },
  
  deviceCard: { backgroundColor: theme.colors.card, borderRadius: 12, padding: 16, marginBottom: 15, borderWidth: 1, borderColor: theme.colors.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  deviceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  iconContainer: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  deviceId: { ...typography.bodyStrong, color: theme.colors.text },
  deviceType: { ...typography.small, fontWeight: 'bold' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginBottom: 4 },
  badgeOnline: { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
  badgeOffline: { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
  statusText: { fontSize: 10, fontWeight: 'bold', color: theme.name === 'light' ? '#000' : '#fff' },
  
actionsRow: { 
    flexDirection: 'row', 
    gap: 10, 
    marginTop: 15, 
    borderTopWidth: 1, 
    borderTopColor: theme.colors.border, 
    paddingTop: 15,
    justifyContent: 'center' // <--- Centraliza os botões
  },  actionButton: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.primary, backgroundColor: theme.colors.card, alignItems: 'center' },
  actionButtonText: { color: theme.colors.primary, fontSize: 13, fontWeight: 'bold' },
  
  deviceStatus: { marginTop: 2, ...typography.smallStrong, marginBottom: 5 },
  sensorStateContainer: { marginTop: 12, padding: 15, backgroundColor: theme.name === 'light' ? '#e5e7eb' : '#111827', borderRadius: 8, alignItems: 'center' },
  sensorStateLabel: { ...typography.small, color: theme.colors.muted, marginBottom: 8 },
  sensorStateText: { ...typography.h2, color: theme.colors.text },
  deviceInfoBlock: { marginTop: 12, gap: 5 },
  deviceInfoText: { ...typography.small, color: theme.colors.muted, fontWeight: 'bold' },
  offlineTimer: { marginTop: 4, ...typography.smallStrong, color: theme.colors.muted },
  
  cardPanicActive: { borderWidth: 2, borderColor: theme.colors.danger, backgroundColor: theme.name === 'light' ? '#fee2e2' : '#331111' },
  cardFallActive: { borderWidth: 2, borderColor: theme.colors.warning, backgroundColor: theme.name === 'light' ? '#fef3c7' : '#3b2f0a' },
  ackHint: { marginTop: 8, ...typography.smallStrong, color: theme.colors.danger, textAlign: 'center' }
});