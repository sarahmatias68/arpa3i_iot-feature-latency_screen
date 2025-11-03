import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAlerts } from './AlertsContext';
import DeviceTypeSelector from './DeviceTypeSelector';

const DeviceRegistryScreen = () => {
  const {
    devicesById,
    deviceTypes,
    updateDeviceType,
    requestSystemBroadcast,
    removeDevice,
  } = useAlerts();

  const [selectorVisible, setSelectorVisible] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [newDeviceId, setNewDeviceId] = useState('');

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
      setNewDeviceId('');
    }
  };

  const handleAddDevice = async () => {
    const id = newDeviceId.trim();
    if (!id) return;
    setSelectedDeviceId(id);
    setSelectorVisible(true);
  };

  const handleClearType = async (deviceId) => {
    await updateDeviceType(deviceId, undefined);
  };

  const renderItem = ({ item }) => (
    <View style={styles.itemRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.deviceId}>{item.deviceId}</Text>
        <Text style={styles.meta}>
          Status: <Text style={{ color: item.connected ? '#10b981' : '#ef4444' }}>{item.connected ? 'online' : 'offline'}</Text>
          {item.deviceType ? `  •  Tipo: ${item.deviceType}` : '  •  Tipo: não definido'}
        </Text>
      </View>
      <TouchableOpacity style={styles.smallButton} onPress={() => openSelector(item.deviceId)}>
        <Text style={styles.smallButtonText}>Definir Tipo</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.smallButton, { backgroundColor: '#ef4444' }]} onPress={() => handleClearType(item.deviceId)}>
        <Text style={styles.smallButtonText}>Limpar Tipo</Text>
      </TouchableOpacity>
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
      >
        <Ionicons name="trash-outline" size={20} color={item.connected ? '#6b7280' : '#ef4444'} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.actionsRow}>
        <TextInput
          placeholder="ID do dispositivo"
          placeholderTextColor="#9ca3af"
          value={newDeviceId}
          onChangeText={setNewDeviceId}
          style={styles.input}
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.addButton} onPress={handleAddDevice}>
          <Text style={styles.addButtonText}>Adicionar</Text>
        </TouchableOpacity>
      </View>

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827', padding: 16 },
  actionsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  input: {
    flex: 1,
    backgroundColor: '#1f2937',
    color: '#f9fafb',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: '#374151',
  },
  addButton: { backgroundColor: '#3b82f6', paddingHorizontal: 16, borderRadius: 8, justifyContent: 'center' },
  addButtonText: { color: '#ffffff', fontWeight: '600' },
  broadcastButton: { backgroundColor: '#10b981', padding: 12, borderRadius: 8, marginBottom: 12, alignItems: 'center' },
  broadcastButtonText: { color: '#06251c', fontWeight: '700' },
  itemRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1f2937', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#374151' },
  deviceId: { color: '#f9fafb', fontWeight: '700', marginBottom: 4 },
  meta: { color: '#9ca3af' },
  smallButton: { backgroundColor: '#374151', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginLeft: 8 },
  smallButtonText: { color: '#f9fafb', fontWeight: '600' },
  iconButton: { marginLeft: 8, padding: 8, borderRadius: 8, backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#374151' },
  iconButtonDanger: { backgroundColor: '#111827' },
});

export default DeviceRegistryScreen;
