/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';

import { createVuetify } from 'vuetify';

const nonce = (window as any).cspNonce;
// console.log('Nonce from window.cspNonce:', nonce); 

export default createVuetify({
  theme: {
    cspNonce: nonce,
    themes: {
      vs_light: {
        dark: false,
        colors: {
          primary: '#F5F5F5',
        }
      },
      vs_dark: {
        dark: true,
        colors: {
          primary: '#263238',

        }
      },
      vs_highContrast: {
        dark: true,
        colors: {
          primary: '#FFFFFF',
          secondary: '#000000',
          accent: '#FFFF00',
          error: '#FF0000',
          info: '#00FF00',
          success: '#0000FF',
          warning: '#FFA500',
        }
      }
    }
  }
});
