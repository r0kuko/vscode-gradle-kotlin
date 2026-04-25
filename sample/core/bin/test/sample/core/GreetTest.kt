package sample.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class GreetTest {
    @Test
    fun `greet returns hello plus name`() {
        assertEquals("Hello, world!", greet("world"))
    }
}
