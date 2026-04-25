plugins {
    alias(libs.plugins.kotlin.jvm)
    application
}

dependencies {
    implementation(project(":core"))
    implementation(project(":modules:featureA"))
    implementation(project(":modules:featureB"))

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.bundles.ktor.client)
    implementation(libs.guava)

    testImplementation(libs.junit.jupiter)
    testImplementation(libs.kotlinx.coroutines.test)
    testRuntimeOnly(libs.junit.platform.launcher)
}

application {
    mainClass.set("sample.app.AppKt")
}

tasks.test {
    useJUnitPlatform()
}

tasks.register("printGreeting") {
    group = "demo"
    description = "Module-level demo task to test the Run-from-sidebar feature."
    doLast {
        println("Greetings from :app!")
    }
}
