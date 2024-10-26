import Boards from '@/components/BoardSelection.vue';
import Home from '@/components/Home.vue';
import BoardConfiguration from '@/components/BoardConfiguration.vue';
import { createRouter, createMemoryHistory } from 'vue-router'
import Updates from '@/components/Updates.vue';
import BoardManager from '@/components/BoardManager.vue';

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
        path: '/board-selection',
        name: "board-selection",
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
      {
        path: '/updates',
        name: "updates",
        components: {
          default: Updates,
        }
      },
      {
        path: '/board-manager',
        name: "board-manager",
        components: {
          default: BoardManager,
        }
      },

    ]
  })
  
  export default router