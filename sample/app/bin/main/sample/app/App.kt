package sample.app

import sample.core.greet
import sample.modules.featureA.featureA
import sample.modules.featureB.featureB

fun main() {
    println(greet("VS Code"))
    println(featureA())
    println(featureB())
}
