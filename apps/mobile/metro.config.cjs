const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')
const config = getDefaultConfig(__dirname)
// Reuse the tested, pure quantity helpers without exposing the root web node_modules.
config.watchFolders = [path.resolve(__dirname, '../../src')]
module.exports = config
