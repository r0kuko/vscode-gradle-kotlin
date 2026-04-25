plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    api(project(":core"))
    implementation(libs.guava)
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
}
