import Boards from '@/components/BoardSelection.vue';
import Home from '@/components/Home.vue';
import BoardConfiguration from '@/components/BoardConfiguration.vue';
import { createRouter, createMemoryHistory } from 'vue-router'
import BoardManager from '@/components/BoardManager.vue';
import LibraryManager from '@/components/LibraryManager.vue';

export const routerBoardSelectionName = 'board-configuration';

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
        name: routerBoardSelectionName,
        components: {
          default: BoardConfiguration,
        }
      },
      {
        path: '/board-manager',
        name: "board-manager",
        components: {
          default: BoardManager,
        }
      },
      {
        path: '/library-manager',
        name: "library-manager",
        components: {
          default: LibraryManager,
        }
      },

    ]
  })
  
  export default router