/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';

// Composables
import { createVuetify } from 'vuetify'

const nonce = (window as any).cspNonce;
console.log('Nonce from window.cspNonce:', nonce); // Add this line

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  theme: {
    cspNonce: nonce,
    themes: {
      vs_light: {
        dark: false,
        colors: {
          primary: '#1976D2',
        }
      },
      vs_dark: {
        dark: true,
        colors: {
          primary: '#37474F',

        }
      },
      vs_highContrast: {
        dark: true,
        colors: {

        }
      }
    }
  }
});
