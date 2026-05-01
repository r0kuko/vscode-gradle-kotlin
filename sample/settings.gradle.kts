rootProject.name = "gradle-kotlin-sample"

include(
    ":app",
    ":core",
    ":ksp-processor",
    ":modules:featureA",
    ":modules:featureB",
)

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}
