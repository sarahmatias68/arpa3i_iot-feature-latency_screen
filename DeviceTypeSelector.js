import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
} from 'react-native';

const DeviceTypeSelector = ({ 
  visible, 
  onClose, 
  onSelectType, 
  deviceTypes, 
  deviceId 
}) => {
  const renderTypeItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.typeItem, { backgroundColor: item.color }]}
      onPress={() => {
        onSelectType(item.id);
        onClose();
      }}
    >
      <Text style={styles.typeIcon}>{item.icon}</Text>
      <Text style={styles.typeName}>{item.name}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>
            Selecionar Tipo para {deviceId}
          </Text>
          <Text style={styles.modalSubtitle}>
            Escolha a categoria que melhor descreve este dispositivo
          </Text>
          
          <FlatList
            data={deviceTypes}
            renderItem={renderTypeItem}
            keyExtractor={(item) => item.id}
            numColumns={2}
            contentContainerStyle={styles.typeList}
          />
          
          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1f2937',
    borderRadius: 15,
    padding: 25,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f9fafb',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 20,
  },
  typeList: {
    paddingVertical: 10,
  },
  typeItem: {
    flex: 1,
    margin: 8,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100,
  },
  typeIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  typeName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  cancelButton: {
    backgroundColor: '#6b7280',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 10,
    marginTop: 20,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default DeviceTypeSelector;
