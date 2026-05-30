import { GameManager } from './core/game-manager.js';

const gameManager = new GameManager();

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await gameManager.init();
    console.log('游戏初始化成功！');
  } catch (error) {
    console.error('游戏初始化失败:', error);
  }
});

window.gameManager = gameManager;
