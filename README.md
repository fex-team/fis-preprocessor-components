fis-preprocessor-components
===========================

给 components 添加短路径功能。

默认短路径不支持跨模块，如果要跨模块，请像这样配置 paths。

```javascript
fis.config.set('settings.preprocessor.components.paths', {
    'jquery': 'common:components/jquery/jquery.js'
});
```

paths 也可以是 dir 如：

```javascript
fis.config.set('settings.preprocessor.components.paths', {
    'bootstrap': 'common:components/bootstrap/'
});
```

这样 `require('bootstrap/button.js')` 的时候，实际上是 `require('common:components/bootstrap/button.js')` 
