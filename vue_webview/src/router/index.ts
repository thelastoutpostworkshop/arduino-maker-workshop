import Boards from '@/components/Boards.vue';
import Home from '@/components/Home.vue';
import BoardConfiguration from '@/components/BoardConfiguration.vue';
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
      {
        path: '/board-configuration',
        name: "board-configuration",
        components: {
          default: BoardConfiguration,
        }
      },

    ]
  })
  
  export default router