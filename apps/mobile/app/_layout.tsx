import { ClerkProvider } from '@clerk/expo'
import { tokenCache } from '@clerk/expo/token-cache'
import { Stack } from 'expo-router'

export default function Layout() {
  return (
    <ClerkProvider
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || ''}
      tokenCache={tokenCache}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </ClerkProvider>
  )
}
