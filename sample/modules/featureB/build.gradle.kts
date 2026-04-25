plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    api(project(":core"))
    implementation(libs.bundles.ktor.client)
    testImplementation(libs.bundles.testing)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
}
