请你参考 vscode-kotlin-test-adapter 和其他插件项目，完成当前 vscode-gradle-kotlin 插件。

这个插件主要有如下功能：
1. 提升在 vscode 中使用 gradle + kotlin 的体验，比如兼容 build.gradle.kts 这种文件，最重要的是我希望对标 jetbrains，首先是可以在 sidebar 里看到每个 gradle module（按照树形结构），然后可以看到每个 module 的一些 task 之类的，而且可以单独运行。
2. 你可能会好奇明明已经有 gradle-java 了为什么还要这么做，这就是我要提到的第二个点。我想的是能不能在 前面这个插件的基础上使用当前插件去提升 patch 前面那个插件对 kotlin developer 不友好的情况。
3. 举个例子，我还希望可以对标 jetbrains 的几个很有用的功能，如下：
  3.1 现在 build.gradle.kts 脚本更新了以后，gradle-java 插件确实也会提醒说脚本 update 了，是不是要重新加载项目，但是我希望对标的是 jetbrains 的开发体验，jetbrains 会在 脚本右上角有一个悬浮的 toolbar，里面有一个 reload project，我觉得那个就很不错。
  3.2 其次就是，在 idea 里，比如在 build.gradle.kts 的 dependencies 脚本块的左侧，会有一个可以运行的按钮，那个非常好用，可以直接让我点击以后就运行依赖加载，看看能不能优化一下。
  3.3 现在 gradle 依赖的管理功能大概率都是使用 libs.versions.toml，我希望一方面是在写依赖的脚本的时候，有代码提示可以直接写里面有的依赖，另一方面就是我打开 build.gradle.kts 的时候，比如那边写的是 implementation(libs.xx.xxx) 我希望这后面有一个类似于 ghost 的直接显示版本的，比如 implementation(libs.xx.xxx:3.1.1) 这效果，但是 3.1.1 是黑色且无法选中之类的。
  3.4 尽可能的对齐在 idea 里使用 gradle 的体验。 
4. AI 支持：现在 vscode 不是已经有一层单独的 agent 层了吗，我在想是不是可以让当前插件提供一个始终可用的 gradle deamon 给 ai 使用，比如执行任务、查看状态之类的，之前让 AI 来写的时候，他始终是调用 bash 来直接比如 ./gradlew xxx 之类的，但是这样会导致开很多个 gradle 进程实例，我希望可以提供一个更友好而且可以更好复用的 AI 友好的功能。
5. 插件的 logo 也是使用脚本去生成，我在想是复用 jetbrains build.gradle.kts 来直接使用，还是我们自己合成生成一个，比如 gradle 的 logo 右下角来个 kotlin logo 什么的。直接用下面 kotlinGradleScript_dark 的那个来生成吧
6. 以下是几个可以使用的 贴图素材地址，
https://intellij-icons.jetbrains.design/icons/KotlinBaseResourcesIcons/org/jetbrains/kotlin/idea/icons/expui/kotlinGradleScript.svg
https://intellij-icons.jetbrains.design/icons/KotlinBaseResourcesIcons/org/jetbrains/kotlin/idea/icons/expui/kotlinGradleScript_dark.svg
https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradleNavigate.svg
https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradleNavigate_dark.svg
https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradleLoadChanges.svg
https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradleLoadChanges_dark.svg
https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradle.svg
https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradle_dark.svg
https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradle@20x20.svg
https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradle@20x20_dark.svg