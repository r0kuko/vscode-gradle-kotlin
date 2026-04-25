plugins {
    alias(libs.plugins.kotlin.jvm) apply false
}

allprojects {
    group = "sample"
    version = "0.1.0"
}

subprojects {
    plugins.withId("org.jetbrains.kotlin.jvm") {
        extensions.configure<org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension> {
            jvmToolchain(21)
        }
    }
}

tasks.register("hello") {
    group = "demo"
    description = "Sanity-check task — prints a friendly greeting."
    doLast {
        println("Hello from the gradle-kotlin-sample root project!")
    }
}
