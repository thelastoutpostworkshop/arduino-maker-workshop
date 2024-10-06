import Boards from '@/components/Boards.vue'
import Home from '@/components/Home.vue'
import { createRouter, createMemoryHistory } from 'vue-router'

const router = createRouter({

    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        name: 'home',
        components: {
          default: Home,
        }
      },
      {
        path: '/boards',
        name: "boards",
        components: {
          default: Boards,
        }
      },

    ]
  })
  
  export default router