import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTheme, typography } from './theme';

const AboutScreen = ({ themeName = 'dark' }) => {
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const openURL = async (url) => {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert(`Não foi possível abrir esta URL: ${url}`);
    }
  };
  return (
    <View style={styles.container}>
      <Ionicons name="shield-checkmark-outline" size={80} color={theme.colors.success} />
      <Text style={styles.title}>ARPA3I - Sistema de Monitoramento</Text>
      <Text style={styles.text}>Versão 1.0.0</Text>
      <Text style={styles.text}> ARPA3I é um sistema de automação composto por um botão de pânico incorporado a uma pulseira, sensores de gás e fumaça, e um aplicativo mobile para receber alertas dos dispositivos 
        permitindo um cuidador monitorar remotamente o ambiente em que um idoso se encontra.</Text>
      <Text style={styles.footer}>© 2025 - Todos os direitos reservados.</Text>

      <View style={styles.devContainer}>
        <Text style={styles.devTitle}>Desenvolvido por</Text>
        <Text style={styles.devName}>Sarah Matias</Text>
        <View style={styles.linksContainer}>
          <TouchableOpacity onPress={() => openURL('https://www.linkedin.com/in/sarah-matias-42a721181/')}>
            <Ionicons name="logo-linkedin" size={40} color="#0e76a8" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => openURL('https://github.com/sarahmatias68')}>
            <Ionicons name="logo-github" size={40} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const createStyles = (theme) => StyleSheet.create({
  devContainer: {
    marginTop: 30,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    alignItems: 'center',
    width: '100%',
  },
  devTitle: {
    ...typography.small,
    color: theme.colors.muted,
  },
  devName: {
    ...typography.h2,
    color: theme.colors.text,
    marginVertical: 8,
    textAlign: 'center',
  },
  linksContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 30,
    marginTop: 10,
  },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background, padding: 20 },
  title: { ...typography.h2, color: theme.colors.text, textAlign: 'center', marginTop: 20, marginBottom: 10 },
  text: { ...typography.body, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 15 },
  footer: { position: 'absolute', bottom: 30, color: theme.colors.muted, fontSize: 12 },
});

export default AboutScreen;
