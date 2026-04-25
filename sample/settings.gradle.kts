rootProject.name = "gradle-kotlin-sample"

include(
    ":app",
    ":core",
    ":modules:featureA",
    ":modules:featureB",
)

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}
