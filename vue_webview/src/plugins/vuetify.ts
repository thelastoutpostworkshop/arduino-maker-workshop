/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import { VTreeview } from 'vuetify/labs/VTreeview'

// Composables
import { createVuetify } from 'vuetify'

const nonce = (window as any).cspNonce;
console.log('Nonce from window.cspNonce:', nonce); // Add this line

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  theme: {
    cspNonce: nonce,
    defaultTheme: 'dark',
  },
  components: {
    VTreeview,
  },
});
