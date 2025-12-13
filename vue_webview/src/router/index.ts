import Boards from '@/components/BoardSelection.vue';
import Home from '@/components/Home.vue';
import BoardConfiguration from '@/components/BoardConfiguration.vue';
import { createRouter, createMemoryHistory } from 'vue-router'
import BoardManager from '@/components/BoardManager.vue';
import LibraryManager from '@/components/LibraryManager.vue';
import LibExamples from '@/components/LibExamples.vue';
import ProfileManager from '@/components/ProfilesManager.vue';
import OtherTools from '@/components/OtherTools.vue';

export const routerBoardSelectionName = 'board-selection';
export const routerBoardConfigurationName = 'board-configuration';

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
        name: routerBoardSelectionName,
        components: {
          default: Boards,
        }
      },
      {
        path: '/board-configuration',
        name: routerBoardConfigurationName,
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
      {
        path: '/library-examples',
        name: "library-examples",
        components: {
          default: LibExamples,
        }
      },
      {
        path: '/profiles-manager',
        name: "profiles-manager",
        components: {
          default: ProfileManager,
        }
      },
      {
        path: '/other-tools',
        name: 'other-tools',
        components: {
          default: OtherTools,
        }
      },

    ]
  })
  
  export default router
