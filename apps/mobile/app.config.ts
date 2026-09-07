if (process.env.EAS_BUILD_PROFILE === 'production') {
  for (const key of [
    'IOS_BUNDLE_IDENTIFIER',
    'EAS_PROJECT_ID',
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_REVENUECAT_IOS_KEY',
    'EXPO_PUBLIC_PRIVACY_URL',
    'EXPO_PUBLIC_TERMS_URL',
  ]) {
    if (
      !process.env[key] ||
      process.env[key]?.includes('example.com') ||
      process.env[key]?.includes('com.example')
    )
      throw new Error(`Production build needs ${key}`)
  }
  for (const key of [
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_PRIVACY_URL',
    'EXPO_PUBLIC_TERMS_URL',
  ]) {
    if (!process.env[key]?.startsWith('https://'))
      throw new Error(`HTTPS required for ${key}`)
  }
}
export default {
  expo: {
    name: 'わが家のレシピ帖',
    slug: 'wagaya-recipe',
    owner: 'oxycasters-organization',
    scheme: 'wagayarecipe',
    version: '0.1.0',
    icon: './assets/icon.png',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      bundleIdentifier:
        process.env.IOS_BUNDLE_IDENTIFIER ||
        'com.oxycastersorganization.wagayarecipe',
      infoPlist: { ITSAppUsesNonExemptEncryption: false },
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-document-picker',
      'expo-image',
    ],
    experiments: { typedRoutes: false },
    extra: {
      eas: {
        projectId:
          process.env.EAS_PROJECT_ID ||
          'c2a88e05-3843-40b4-ad22-6c2c0e11c464',
      },
    },
  },
}
