import os from 'node:os';

const originalUserInfo = os.userInfo;

try {
  originalUserInfo();
} catch (error) {
  os.userInfo = (options = {}) => {
    if (options.encoding && options.encoding !== 'utf8') return {};
    const username = process.env.USERNAME || process.env.USER || 'user';
    const homedir = process.env.USERPROFILE || process.env.HOME || process.cwd();
    return {
      uid: -1,
      gid: -1,
      username,
      homedir,
      shell: null,
    };
  };

  process.emitWarning(
    `Patched os.userInfo() after ${error?.code || 'an unknown system error'} so Node preloads can start.`,
    { code: 'JOBRIN_USERINFO_FALLBACK' },
  );
}
