const IS_SAI_ROOMS = process.env.APP_VARIANT === 'sairooms';

export default {
  expo: {
    name: "Sai-Homes-Rents",
    slug: IS_SAI_ROOMS ? "sairooms-rental-manager-mobile" : "rental-manager-mobile",
    version: "1.0.1",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: IS_SAI_ROOMS ? "sairoomsrentalmanager" : "rentalmanagermobile",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png"
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: IS_SAI_ROOMS ? "com.sairooms.rentalmanager" : "com.mani.nimmala.rentalmanagermobile"
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png"
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#ffffff",
          "dark": {
            "backgroundColor": "#000000"
          }
        }
      ],
      "expo-sqlite",
      "@react-native-community/datetimepicker"
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true
    },
    extra: {
      router: {},
      eas: {
        projectId: IS_SAI_ROOMS ? "c45aadc4-aefe-4920-90fb-526f0cd255e6" : "3fdc5ba0-ac01-4a91-b836-e99268edad38"
      }
    }
  }
};
