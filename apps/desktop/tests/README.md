# 测试目录

测试按运行模块放入 `main/`、`renderer/`、`preload/`、`shared/`。目前预加载脚本没有对外 API，通用模块只有应用名称常量，因此对应目录暂不添加空泛测试。新增行为时在相应目录添加 `*.test.ts` 或 `*.test.tsx`。
