package sample.app

@Target(AnnotationTarget.CLASS)
annotation class RequireId

@RequireId
data class KspFailureSample(
    val name: String,
)
