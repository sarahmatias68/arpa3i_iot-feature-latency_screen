import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAlerts } from './AlertsContext';
import DeviceTypeSelector from './DeviceTypeSelector';
import { getTheme, typography } from './theme';

const DeviceRegistryScreen = ({ navigation, themeName = 'dark' }) => {
  const {
    devicesById,
    deviceTypes,
    updateDeviceType,
    requestSystemBroadcast,
    removeDevice,
  } = useAlerts();

  const [selectorVisible, setSelectorVisible] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const devices = useMemo(() => Object.values(devicesById).sort((a, b) => a.deviceId.localeCompare(b.deviceId)), [devicesById]);

  const openSelector = (deviceId) => {
    setSelectedDeviceId(deviceId);
    setSelectorVisible(true);
  };

  const handleSelectType = async (typeId) => {
    if (selectedDeviceId) {
      await updateDeviceType(selectedDeviceId, typeId);
      setSelectedDeviceId(null);
      setSelectorVisible(false);
    }
  };

  const handleClearType = async (deviceId) => {
    await updateDeviceType(deviceId, undefined);
  };

  const navigateToDevice = (deviceId) => {
    navigation.navigate('CategoryDevices', {
      categoryTitle: 'Dispositivo',
      categoryIcon: '📟',
      categoryKey: 'detector',
      focusDeviceId: deviceId,
    });
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.itemRow}
      onPress={() => navigateToDevice(item.deviceId)}
      activeOpacity={0.9}
    >
      <View style={styles.itemBody}>
        <View style={styles.itemHeader}>
          <Text style={styles.deviceId}>{item.deviceId}</Text>
          <TouchableOpacity
            style={[styles.iconButton, !item.connected && styles.iconButtonDanger]}
            onPress={() => {
              if (item.connected) {
                Alert.alert('Não permitido', 'Só é possível excluir dispositivos offline.');
                return;
              }
              Alert.alert('Excluir dispositivo', `Deseja remover '${item.deviceId}' da lista?`, [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Excluir', style: 'destructive', onPress: () => removeDevice(item.deviceId) },
              ]);
            }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="trash-outline" size={20} color={item.connected ? theme.colors.muted : theme.colors.danger} />
          </TouchableOpacity>
        </View>
        <Text style={styles.meta}>
          Status: <Text style={{ color: item.connected ? theme.colors.success : theme.colors.danger }}>{item.connected ? 'online' : 'offline'}</Text>
          {item.deviceType ? `  \nTipo: ${item.deviceType}` : '  \nTipo: não definido'}
        </Text>
      </View>
      <View style={styles.actionsColumn}>
        <TouchableOpacity style={styles.fullButton} onPress={() => openSelector(item.deviceId)}>
          <Text style={styles.fullButtonText}>Definir Tipo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.fullButton, styles.fullButtonSecondary]} onPress={() => handleClearType(item.deviceId)}>
          <Text style={[styles.fullButtonText, styles.fullButtonSecondaryText]}>Limpar Tipo</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.broadcastButton} onPress={requestSystemBroadcast}>
        <Text style={styles.broadcastButtonText}>Solicitar status dos dispositivos</Text>
      </TouchableOpacity>

      <FlatList
        data={devices}
        keyExtractor={(item) => item.deviceId}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={{ paddingVertical: 8 }}
      />

      <DeviceTypeSelector
        visible={selectorVisible}
        onClose={() => setSelectorVisible(false)}
        onSelectType={handleSelectType}
        deviceTypes={deviceTypes}
        deviceId={selectedDeviceId || ''}
      />
    </View>
  );
};

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: 16 },
  broadcastButton: { backgroundColor: theme.colors.success, padding: 12, borderRadius: 8, marginBottom: 12, alignItems: 'center' },
  broadcastButtonText: { color: theme.name === 'light' ? theme.colors.text : '#06251c', fontWeight: '700' },
  itemRow: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: theme.colors.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, gap: 12 },
  itemBody: { flex: 1 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  deviceId: { color: theme.colors.text, marginBottom: 4, ...typography.bodyStrong },
  meta: { color: theme.colors.muted, ...typography.small, fontWeight: 'bold', padding:2},
  actionsColumn: { justifyContent: 'space-between', gap: 8 },
  fullButton: { backgroundColor: theme.colors.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center' },
  fullButtonSecondary: { backgroundColor: theme.colors.border },
  fullButtonText: { color: theme.name === 'light' ? '#ffffff' : theme.colors.text, fontWeight: '600' },
  fullButtonSecondaryText: { color: theme.colors.text },
  iconButton: { padding: 8, borderRadius: 8, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  iconButtonDanger: { backgroundColor: theme.colors.background },
});

export default DeviceRegistryScreen;
