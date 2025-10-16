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
      style={styles.typeItem}
      onPress={() => {
        onSelectType(item.id);
        onClose();
      }}
    >
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
            Selecionar Tipo
          </Text>
          <Text style={styles.modalSubtitle}>
            {deviceId}
          </Text>
          
          <FlatList
            data={deviceTypes}
            renderItem={renderTypeItem}
            keyExtractor={(item) => item.id}
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
    fontStyle: 'italic',
  },
  typeList: {
    paddingVertical: 10,
  },
  typeItem: {
    backgroundColor: '#374151',
    padding: 18,
    borderRadius: 10,
    marginVertical: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4b5563',
  },
  typeName: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '600',
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
