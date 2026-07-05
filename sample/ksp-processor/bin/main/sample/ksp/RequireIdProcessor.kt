package sample.ksp

import com.google.devtools.ksp.processing.CodeGenerator
import com.google.devtools.ksp.processing.KSPLogger
import com.google.devtools.ksp.processing.Resolver
import com.google.devtools.ksp.processing.SymbolProcessor
import com.google.devtools.ksp.processing.SymbolProcessorEnvironment
import com.google.devtools.ksp.processing.SymbolProcessorProvider
import com.google.devtools.ksp.symbol.KSAnnotated
import com.google.devtools.ksp.symbol.KSClassDeclaration

class RequireIdProcessorProvider : SymbolProcessorProvider {
    override fun create(environment: SymbolProcessorEnvironment): SymbolProcessor =
        RequireIdProcessor(environment.codeGenerator, environment.logger)
}

private class RequireIdProcessor(
    @Suppress("unused") private val codeGenerator: CodeGenerator,
    private val logger: KSPLogger,
) : SymbolProcessor {
    override fun process(resolver: Resolver): List<KSAnnotated> {
        val symbols = resolver.getSymbolsWithAnnotation("sample.app.RequireId")
        for (symbol in symbols) {
            val declaration = symbol as? KSClassDeclaration ?: continue
            val hasId = declaration.getAllProperties().any { it.simpleName.asString() == "id" }
            if (!hasId) {
                logger.error(
                    "Illegal type \"${declaration.qualifiedName?.asString()}\", it is decorated by \"@sample.app.RequireId\" but there is no id property",
                    declaration,
                )
            }
        }
        return emptyList()
    }
}
